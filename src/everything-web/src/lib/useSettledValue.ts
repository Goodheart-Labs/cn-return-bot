import { useEffect, useState } from "react";

/** How long a value must stay unchanged before a list reloads for it. A
 *  slider sends a new value for every step it is dragged across, and each one
 *  would otherwise ask the server for a new list. */
const SETTLE_MS = 300;

/** The value once it has stopped changing for a moment. */
export function useSettledValue<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}
