import { useState } from "react";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A value the reader set, remembered on this device under `key` as the text
 *  `serialize` makes of it. `parse` turns stored text back into a value. It
 *  gets null when nothing is stored, and it must return a default for text
 *  that is missing or no longer valid. */
export function useStoredValue<T>(key: string, parse: (stored: string | null) => T, serialize: (value: T) => string): [T, (value: T) => void] {
  const [value, setValue] = useState(() => parse(readStored(key)));
  const store = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, serialize(next));
    } catch {
      // Without storage the value lasts until the page reloads.
    }
  };
  return [value, store];
}

/** A choice the reader made, such as the order of a list, remembered on this
 *  device under `key`. A stored value that is no longer one of `choices` reads
 *  as `fallback`. */
export const useStoredChoice = <T extends string>(key: string, choices: readonly T[], fallback: T) =>
  useStoredValue<T>(key, (stored) => choices.find((choice) => choice === stored) ?? fallback, String);
