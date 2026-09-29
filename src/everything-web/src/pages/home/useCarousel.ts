import { useEffect, useState, useSyncExternalStore } from "react";

/** How long each slide stays before the next one comes. */
const SECONDS_PER_SLIDE = 6;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const subscribeToMotionSetting = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

/** The state of a carousel that moves on by itself. Every manual move starts
 *  the timer over. It holds still while the pointer or the keyboard focus is
 *  inside it (spread `holdProps` on its outer element), and never moves by
 *  itself for a reader who asked their system for reduced motion. It draws
 *  nothing, so every version of the homepage can draw its own. */
export function useCarousel(count: number) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionSetting, prefersReducedMotion);

  useEffect(() => {
    if (held || reducedMotion) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % count), SECONDS_PER_SLIDE * 1000);
    return () => window.clearTimeout(timer);
  }, [index, held, reducedMotion, count]);

  return {
    index,
    go: (next: number) => setIndex((next + count) % count),
    held,
    holdProps: {
      onMouseEnter: () => setHeld(true),
      onMouseLeave: () => setHeld(false),
      onFocus: () => setHeld(true),
      onBlur: () => setHeld(false),
    },
  };
}
