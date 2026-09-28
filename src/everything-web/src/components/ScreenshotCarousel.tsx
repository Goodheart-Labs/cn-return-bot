import { useEffect, useState, useSyncExternalStore } from "react";
import { NextIcon, PreviousIcon } from "@cn/ui/icons";
import { cn } from "@cn/ui/cn";

export interface Screenshot {
  src: string;
  /** What the screenshot shows, for screen readers. */
  alt: string;
  /** The line under the frame while this screenshot is showing. */
  caption: string;
}

/** How long each screenshot stays before the next one slides in. */
const SECONDS_PER_SCREENSHOT = 6;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const subscribeToMotionSetting = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

/** Screenshots of the extension at work, in a frame that moves on to the
 *  next one by itself. The arrows and the dots move it by hand, and every
 *  manual move starts the timer over. It holds still while the pointer or the
 *  keyboard focus is inside it, and never moves by itself for a reader who
 *  asked their system for reduced motion. */
export function ScreenshotCarousel({ screenshots }: { screenshots: readonly Screenshot[] }) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotionSetting, prefersReducedMotion);
  const count = screenshots.length;
  const go = (next: number) => setIndex((next + count) % count);

  useEffect(() => {
    if (held || reducedMotion) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % count), SECONDS_PER_SCREENSHOT * 1000);
    return () => window.clearTimeout(timer);
  }, [index, held, reducedMotion, count]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Screenshots of the extension"
      className="w-full"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="group relative overflow-hidden rounded-card border border-line bg-inverse shadow-floating">
        <div className="flex transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${index * 100}%)` }}>
          {screenshots.map((shot, i) => (
            <div
              key={shot.src}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== index}
              className="w-full shrink-0"
            >
              <img src={shot.src} alt={shot.alt} width={1280} height={800} className="block aspect-[16/10] w-full object-cover object-top" />
            </div>
          ))}
        </div>
        {[
          { label: "Previous screenshot", step: -1, Icon: PreviousIcon, side: "left-3" },
          { label: "Next screenshot", step: 1, Icon: NextIcon, side: "right-3" },
        ].map(({ label, step, Icon, side }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={() => go(index + step)}
            className={cn(
              "absolute top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-surface/90 text-fg shadow-raised transition-opacity hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
              side,
            )}
          >
            <Icon size={20} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-start justify-between gap-4">
        <p className="text-sm text-fg-muted" aria-live={held ? "polite" : "off"}>
          {screenshots[index]!.caption}
        </p>
        <div className="flex shrink-0 gap-1.5 pt-1.5">
          {screenshots.map((shot, i) => (
            <button
              key={shot.src}
              type="button"
              aria-label={`Show screenshot ${i + 1}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className="h-2 w-2 rounded-full bg-line-strong transition-[width,background-color] duration-300 aria-[current=true]:w-5 aria-[current=true]:bg-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
