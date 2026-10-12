import { useEffect, useRef, useState } from "react";

/** Whether the tab has been visible for `ms` in total while `counting` was
 *  true. Time with the tab hidden does not count, so a tab opened in the
 *  background does not run down the clock. When `counting` turns false the
 *  time spent so far is kept, and it adds up again when `counting` turns true.
 *  So a caller that stays mounted across pages sums the time on all of them. */
export function useVisibleFor(ms: number, counting: boolean): boolean {
  const spentMs = useRef(0);
  const [reached, setReached] = useState(false);

  useEffect(() => {
    if (!counting || reached) return;
    let resumedAt: number | null = null;
    let timer: number | undefined;
    const resume = () => {
      if (resumedAt !== null) return;
      resumedAt = performance.now();
      timer = window.setTimeout(() => setReached(true), ms - spentMs.current);
    };
    const pause = () => {
      if (resumedAt === null) return;
      spentMs.current += performance.now() - resumedAt;
      resumedAt = null;
      window.clearTimeout(timer);
    };
    const followVisibility = () => (document.visibilityState === "visible" ? resume() : pause());
    followVisibility();
    document.addEventListener("visibilitychange", followVisibility);
    return () => {
      document.removeEventListener("visibilitychange", followVisibility);
      pause();
    };
  }, [ms, counting, reached]);

  return reached;
}
