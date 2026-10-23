import { useCallback, useState } from "react";
import { useLoadMoreSentinel } from "@cn/features/query/useLoadMoreSentinel";

/** How many cards the page renders at first, and how many more it adds each
 *  time the reader scrolls near the end. Every YouTube card starts a video
 *  player, so rendering all notes of the site at once would make the page
 *  slow. */
const CARDS_PER_STEP = 30;

/** Returns how many cards to render and the element to put after the last
 *  one. When that element comes near the screen, the count grows by one step.
 *  The count starts over when `resetKey` changes. */
export function useGrowingCount(resetKey: string): [number, (sentinel: HTMLElement | null) => void] {
  const [count, setCount] = useState(CARDS_PER_STEP);
  const [countedFor, setCountedFor] = useState(resetKey);
  // Resetting during render is React's pattern for state derived from props:
  // React re-renders straight away with the new count.
  if (countedFor !== resetKey) {
    setCountedFor(resetKey);
    setCount(CARDS_PER_STEP);
  }
  const growCount = useCallback(() => setCount((shown) => shown + CARDS_PER_STEP), []);
  return [count, useLoadMoreSentinel(growCount, count)];
}
