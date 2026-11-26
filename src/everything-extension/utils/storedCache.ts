import { browser } from "#imports";

/** A map of answers that never change, kept in the extension's local storage
 *  so they survive restarts. Examples are which post a Substack reader link
 *  leads to, or which publication a custom domain belongs to.
 *
 *  `remember` computes a missing answer once. Callers in the same context that
 *  ask for the same key while the computation runs share it, so two scripts
 *  asking about one page cause one fetch. A null answer is not stored, so it
 *  is computed again next time.
 *
 *  The background and the popup both write. Each write adds its entry to the
 *  map as it is stored now, so two writers lose at most an entry when they
 *  write at the same moment, which costs one more fetch later. When the map
 *  grows past `max` entries, the first entries in storage order are dropped.
 *  Those are the oldest written ones, or for numeric keys such as post ids,
 *  the smallest. */
export function storedCache<T>(storageKey: string, max: number) {
  const pending = new Map<string, Promise<T | null>>();
  const readStored = async () => ((await browser.storage.local.get(storageKey))[storageKey] as Record<string, T> | undefined) ?? {};

  async function compute(key: string, answer: () => Promise<T | null>): Promise<T | null> {
    const known = (await readStored())[key];
    if (known !== undefined) return known;
    const value = await answer();
    if (value === null) return null;
    const stored = await readStored();
    stored[key] = value;
    await browser.storage.local.set({ [storageKey]: Object.fromEntries(Object.entries(stored).slice(-max)) });
    return value;
  }

  return {
    remember(key: string, answer: () => Promise<T | null>): Promise<T | null> {
      const running = pending.get(key);
      if (running) return running;
      const result = compute(key, answer).finally(() => pending.delete(key));
      pending.set(key, result);
      return result;
    },
  };
}
