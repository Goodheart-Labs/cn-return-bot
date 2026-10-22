import { useEffect, useState } from "react";

/** How many cards the page renders at first, and how many more it adds each
 *  time the reader scrolls near the end. Every YouTube card starts a video
 *  player, so rendering all notes of the site at once would make the page
 *  slow. */
const CARDS_PER_STEP = 30;

/** How far below the screen the end of the feed may still be when the next
 *  cards are added, so they are ready before the reader gets there. */
const LOAD_AHEAD_MARGIN = "1500px";

/** Returns how many cards to render and the element to put after the last
 *  one. When that element comes near the screen, the count grows by one step.
 *  The count starts over when `resetKey` changes. */
export function useGrowingCount(resetKey: string): [number, (sentinel: HTMLDivElement | null) => void] {
  const [count, setCount] = useState(CARDS_PER_STEP);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [countedFor, setCountedFor] = useState(resetKey);
  // Resetting during render is React's pattern for state derived from props:
  // React re-renders straight away with the new count.
  if (countedFor !== resetKey) {
    setCountedFor(resetKey);
    setCount(CARDS_PER_STEP);
  }
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setCount((shown) => shown + CARDS_PER_STEP);
      },
      { rootMargin: `0px 0px ${LOAD_AHEAD_MARGIN} 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, count]);
  return [count, setSentinel];
}
