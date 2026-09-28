/** The slice of the WebExtension storage API that shared code uses. The
 *  website and the extension run the same shared modules, and only the
 *  extension has this API, so shared code asks for it at runtime instead of
 *  importing WXT's `browser` object. */
interface StorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

type StorageChangeListener = (changes: Record<string, unknown>, area: string) => void;

export interface ExtensionStorage {
  local: StorageArea;
  sync: StorageArea;
  onChanged: {
    addListener(listener: StorageChangeListener): void;
    removeListener(listener: StorageChangeListener): void;
  };
}

/** The extension's storage, or null on a plain web page. Firefox exposes the
 *  promise-based API as `browser`. Chrome only has `chrome`, which is
 *  promise-based under Manifest V3. On a web page neither exposes `.storage`. */
export function extensionStorage(): ExtensionStorage | null {
  const g = globalThis as { browser?: { storage?: ExtensionStorage }; chrome?: { storage?: ExtensionStorage } };
  return g.browser?.storage ?? g.chrome?.storage ?? null;
}

/** Reads a true-or-false flag that belongs to this browser rather than to one
 *  page. The extension keeps it in its own storage, shared by the popup, the
 *  overlays on every site and the background. The website keeps it in
 *  localStorage. A browser that blocks storage reads every flag as unset. */
export async function readBrowserFlag(key: string, area: "local" | "sync"): Promise<boolean> {
  const ext = extensionStorage();
  if (ext) return !!(await ext[area].get(key))[key];
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Sets a flag that readBrowserFlag reads. A browser that blocks storage
 *  cannot remember it, and the flag then reads as unset on the next visit. */
export function setBrowserFlag(key: string, area: "local" | "sync"): void {
  const ext = extensionStorage();
  if (ext) {
    void ext[area].set({ [key]: true });
    return;
  }
  try {
    localStorage.setItem(key, "true");
  } catch {
    // Nowhere to keep it.
  }
}

/** Which app this code runs in, as the votes table records it. */
export const currentPlatform = (): "web" | "extension" => (extensionStorage() ? "extension" : "web");
