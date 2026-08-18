import { useEffect, useRef, useState } from "react";

/** How long the overlay stays before it fades out on its own. Hovering pauses
 *  the clock, so a reader who is about to click never loses the card. */
const AUTO_HIDE_MS = 5_000;
/** After a request or follow succeeded the card lingers briefly to show the
 *  confirmation, then leaves. */
const DONE_HIDE_MS = 4_000;
/** How long the fade-out takes once the clock has run out. Hovering during the
 *  fade brings the card back. */
const FADE_MS = 700;

type ActionPhase = "idle" | "busy" | "done" | "error";

/** One overlay action: the button label, the confirmation text once it ran,
 *  and what it does. `alreadyDone` starts true when the user already asked
 *  earlier, so reopening the page shows the confirmation instead of the
 *  button. */
export interface StatusAction {
  label: string;
  doneLabel: string;
  alreadyDone: boolean;
  run: () => Promise<void>;
}

export interface StatusOverlayProps {
  /** The card's first line. Null on an author surface, where the follow
   *  button carries all the information by itself. */
  headline: string | null;
  request: StatusAction | null;
  follow: StatusAction | null;
}

export function ActionButton({ action, onDone, buttonClassName }: {
  action: StatusAction;
  onDone?: () => void;
  /** Overrides the card-sized button look. The popup passes its own full-width
   *  button style so the action matches the buttons around it. */
  buttonClassName?: string;
}) {
  const [phase, setPhase] = useState<ActionPhase>(action.alreadyDone ? "done" : "idle");

  const run = async () => {
    setPhase("busy");
    try {
      await action.run();
      setPhase("done");
      onDone?.();
    } catch {
      setPhase("error");
    }
  };

  if (phase === "done") return <p className="text-xs text-green-700 dark:text-green-400">{action.doneLabel}</p>;
  return (
    <div>
      <button
        onClick={run}
        disabled={phase === "busy"}
        className={buttonClassName ?? "bg-blue-600 text-white rounded-md px-2.5 py-1 text-xs font-medium hover:bg-blue-700 disabled:opacity-40 text-left"}
      >
        {action.label}
      </button>
      {phase === "error" && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Something went wrong. Try again</p>}
    </div>
  );
}

/** The transient status card shown when a page opens. It says whether we have
 *  checked the page, offers the request and follow buttons, and fades away
 *  after a few seconds so it never becomes furniture. */
export function StatusOverlay({ headline, request, follow }: StatusOverlayProps) {
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
      className={`w-96 rounded-lg border border-gray-200 bg-white p-3 shadow-lg transition-opacity ease-out dark:border-gray-700 dark:bg-gray-800 ${phase === "fading" ? "opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      onMouseEnter={keep}
      onMouseLeave={() => hideAfter(AUTO_HIDE_MS)}
    >
      <div className="flex items-start justify-between gap-2">
        {headline && <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{headline}</p>}
        <button
          onClick={() => setPhase("hidden")}
          aria-label="Dismiss"
          className="ml-auto shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          ✕
        </button>
      </div>
      <div className={`space-y-2 ${headline ? "mt-2" : ""}`}>
        {request && <ActionButton action={request} onDone={() => hideAfter(DONE_HIDE_MS)} />}
        {follow && <ActionButton action={follow} onDone={() => hideAfter(DONE_HIDE_MS)} />}
      </div>
    </div>
  );
}
