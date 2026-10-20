import { useState } from "react";

function readChoice<T extends string>(key: string, choices: readonly T[], fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return choices.find((choice) => choice === stored) ?? fallback;
  } catch {
    return fallback;
  }
}

/** A choice the reader made, such as the order of a list, remembered on this
 *  device under `key`. A stored value that is no longer one of `choices` reads
 *  as `fallback`. */
export function useStoredChoice<T extends string>(key: string, choices: readonly T[], fallback: T): [T, (choice: T) => void] {
  const [choice, setChoice] = useState(() => readChoice(key, choices, fallback));
  const choose = (next: T) => {
    setChoice(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Without storage the choice lasts until the page reloads.
    }
  };
  return [choice, choose];
}
