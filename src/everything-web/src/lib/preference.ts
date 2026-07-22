import { useSyncExternalStore } from "react";

/** A localStorage-backed preference shared by every hook instance on the page:
 *  setting it anywhere updates all mounted components live, and future
 *  sessions start from the stored value. Primitive values only — snapshots are
 *  compared with Object.is. */
export function createLocalPreference<T extends string | boolean>(
  key: string,
  { parse, serialize }: { parse: (raw: string | null) => T; serialize: (value: T) => string },
) {
  const listeners = new Set<() => void>();
  const read = () => parse(localStorage.getItem(key));
  const fallback = parse(null);
  return function usePreference(): [T, (value: T) => void] {
    const value = useSyncExternalStore(
      (onChange) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
      read,
      () => fallback, // server snapshot (no localStorage during SSR/build)
    );
    const set = (next: T) => {
      localStorage.setItem(key, serialize(next));
      listeners.forEach((fn) => fn());
    };
    return [value, set];
  };
}
