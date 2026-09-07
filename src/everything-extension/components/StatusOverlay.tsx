import { useEffect, useRef, useState } from "react";
import { BUTTON, FLOATING_CARD } from "../../everything-shared/ui";
import { IconButton } from "../../everything-web/src/components/IconButton";

/** How long the overlay stays before it fades out on its own. Hovering pauses
 *  the clock, so a reader who is about to click never loses the card. */
const AUTO_HIDE_MS = 7_000;
/** How long the fade-out takes once the clock has run out. Hovering during the
 *  fade brings the card back. */
const FADE_MS = 700;

type ActionPhase = "idle" | "busy" | "done" | "error";

/** One action button: the label, the confirmation text once it ran, and what
 *  it does. `alreadyDone` starts true when the action has already been taken,
 *  so the card shows the confirmation instead of the button. Only the popup
 *  renders one of these; the in-page card has been headline-only since the
 *  request and follow cards were removed (GOO-71). */
export interface StatusAction {
  label: string;
  doneLabel: string;
  alreadyDone: boolean;
  run: () => Promise<void>;
}

export interface StatusOverlayProps {
  /** The card's first line. */
  headline: string;
  /** Makes the headline clickable. The note-count card passes the jump here,
   *  so clicking the card walks the notes like the popup's jump button. */
  onHeadlineClick?: () => void;
}

export function ActionButton({ action }: { action: StatusAction }) {
  const [phase, setPhase] = useState<ActionPhase>(action.alreadyDone ? "done" : "idle");

  const run = async () => {
    setPhase("busy");
    try {
      await action.run();
      setPhase("done");
    } catch {
      setPhase("error");
    }
  };

  if (phase === "done") return <p className="text-sm text-green-700 dark:text-green-400">{action.doneLabel}</p>;
  return (
    <div>
      <button onClick={run} disabled={phase === "busy"} className={`${BUTTON} w-full`}>
        {action.label}
      </button>
      {phase === "error" && <p className="mt-2 text-sm text-red-600 dark:text-red-400">Something went wrong. Try again</p>}
    </div>
  );
}

/** The transient status card shown when a page opens. It says how the page
 *  stands, and it fades away after a few seconds so it never becomes
 *  furniture. */
export function StatusOverlay({ headline, onHeadlineClick }: StatusOverlayProps) {
  const [phase, setPhase] = useState<"shown" | "fading" | "hidden">("shown");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimers = () => {
    clearTimeout(hideTimer.current);
    clearTimeout(fadeTimer.current);
  };

  const hideAfter = (ms: number) => {
    clearTimers();
    hideTimer.current = setTimeout(() => {
      setPhase("fading");
      fadeTimer.current = setTimeout(() => setPhase("hidden"), FADE_MS);
    }, ms);
  };

  const keep = () => {
    clearTimers();
    setPhase("shown");
  };

  useEffect(() => {
    hideAfter(AUTO_HIDE_MS);
    return clearTimers;
  }, []);

  if (phase === "hidden") return null;
  return (
    <div
      className={`max-w-[24rem] ${FLOATING_CARD} p-4 transition-opacity ease-out ${phase === "fading" ? "opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      onMouseEnter={keep}
      onMouseLeave={() => hideAfter(AUTO_HIDE_MS)}
    >
      <div className="flex items-start justify-between gap-2">
        {onHeadlineClick ? (
          <button
            onClick={onHeadlineClick}
            className="text-left text-sm font-medium text-gray-900 underline-offset-2 hover:underline dark:text-gray-100"
          >
            {headline}
          </button>
        ) : (
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{headline}</p>
        )}
        <IconButton label="Dismiss" className="ml-auto" onClick={() => setPhase("hidden")}>
          ✕
        </IconButton>
      </div>
    </div>
  );
}
