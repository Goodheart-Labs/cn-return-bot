import { useSyncExternalStore } from "react";

/** Creates a hook for one preference stored in localStorage. Every instance of
 *  the hook on the page shares it, so setting it anywhere updates all mounted
 *  components at once. A later session starts from the stored value. Only
 *  primitive values work, because snapshots are compared with Object.is. */
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
      () => fallback, // The server snapshot. There is no localStorage during a build.
    );
    const set = (next: T) => {
      localStorage.setItem(key, serialize(next));
      listeners.forEach((fn) => fn());
    };
    return [value, set];
  };
}
