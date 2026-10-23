import { useEffect, useState } from "react";

/** How far below the screen the end of a list may still be when the next part
 *  is loaded, so it is ready before the reader gets there. */
const LOAD_AHEAD_MARGIN = "1500px";

/** Loads more of a list as the reader scrolls. The page puts an empty element
 *  after the list's last entry, through the ref this returns. When that
 *  element comes within LOAD_AHEAD_MARGIN of the screen, `loadMore` runs.
 *
 *  `shown` is how many entries the list shows. Each time it changes, the
 *  element is checked again. So a list that is still too short to reach the
 *  bottom of the screen keeps loading until it does, or until the page stops
 *  rendering the element because nothing is left to load. */
export function useLoadMoreSentinel(loadMore: () => void, shown: number): (sentinel: HTMLElement | null) => void {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: `0px 0px ${LOAD_AHEAD_MARGIN} 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, loadMore, shown]);
  return setSentinel;
}
