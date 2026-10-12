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

const wrap = (n: number, count: number) => ((n % count) + count) % count;

/** The shorter way round from one slide to another: positive moves right,
 *  negative moves left. */
function shortestStep(from: number, to: number, count: number): number {
  const forward = wrap(to - from, count);
  return forward > count / 2 ? forward - count : forward;
}

/** The state of an endless carousel that moves on by itself. The slides sit
 *  on a strip that repeats forever in both directions, so going left from the
 *  first slide shows the last one coming in from the left, and the last slide
 *  is followed by the first. `position` counts steps along that strip without
 *  ever wrapping round, and `index` is the slide it shows.
 *
 *  `strip` lists the copies of the slides around the current one, each with a
 *  stable key and its distance from the middle in slide widths. A copy keeps
 *  its key while the strip moves, so its CSS transition slides it along. New
 *  copies appear at the far ends, out of sight.
 *
 *  Every manual move starts the timer over. It holds still while the pointer
 *  or the keyboard focus is inside it (spread `holdProps` on its outer
 *  element), and never moves by itself for a reader who asked their system
 *  for reduced motion. It draws nothing, so every version of the homepage can
 *  draw its own. */
export function useCarousel(count: number) {
  const [position, setPosition] = useState(0);
  const [held, setHeld] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionSetting, prefersReducedMotion);

  useEffect(() => {
    if (held || reducedMotion) return;
    const timer = window.setTimeout(() => setPosition((p) => p + 1), SECONDS_PER_SLIDE * 1000);
    return () => window.clearTimeout(timer);
  }, [position, held, reducedMotion]);

  const strip = Array.from({ length: 2 * count + 1 }, (_, i) => {
    const key = position - count + i;
    return { key, index: wrap(key, count), offset: key - position };
  });

  return {
    index: wrap(position, count),
    strip,
    step: (steps: number) => setPosition((p) => p + steps),
    go: (target: number) => setPosition((p) => p + shortestStep(wrap(p, count), target, count)),
    held,
    holdProps: {
      onMouseEnter: () => setHeld(true),
      onMouseLeave: () => setHeld(false),
      onFocus: () => setHeld(true),
      onBlur: () => setHeld(false),
    },
  };
}
