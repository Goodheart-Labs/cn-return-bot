import { useEffect, useRef, useState } from "react";

/** How long the overlay stays before it fades out on its own. Hovering pauses
 *  the clock, so a reader who is about to click never loses the card. */
const AUTO_HIDE_MS = 10_000;
/** After a request or follow succeeded the card lingers briefly to show the
 *  confirmation, then leaves. */
const DONE_HIDE_MS = 4_000;

type ActionPhase = "idle" | "busy" | "done" | "error";

/** One overlay action: the button label, the confirmation text once it ran,
 *  and what it does. `done` starts true when the user already asked earlier,
 *  so reopening the page shows the confirmation instead of the button. */
export interface StatusAction {
  label: string;
  doneLabel: string;
  alreadyDone: boolean;
  run: () => Promise<void>;
}

export interface StatusOverlayProps {
  /** What the card calls the current page: a Substack post, a YouTube video, or
   *  a plain page. */
  noun: "post" | "video" | "page";
  /** Null while the page has not been checked, otherwise its note count. */
  checked: { noteCount: number } | null;
  /** Whether we have checked other pages by this author. Only shown while the
   *  page itself is unchecked, where it tells the reader we know the author. */
  authorCovered: boolean;
  request: StatusAction | null;
  follow: StatusAction | null;
}

function checkedLine(noun: string, noteCount: number): string {
  if (noteCount === 0) return `We checked this ${noun} and found nothing to note.`;
  return noteCount === 1 ? `We checked this ${noun} — 1 Common Note.` : `We checked this ${noun} — ${noteCount} Common Notes.`;
}

function ActionButton({ action, onDone }: { action: StatusAction; onDone: () => void }) {
  const [phase, setPhase] = useState<ActionPhase>(action.alreadyDone ? "done" : "idle");

  const run = async () => {
    setPhase("busy");
    try {
      await action.run();
      setPhase("done");
      onDone();
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
        className="bg-blue-600 text-white rounded-md px-2.5 py-1 text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
      >
        {action.label}
      </button>
      {phase === "error" && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Something went wrong — try again</p>}
    </div>
  );
}

/** The transient status card shown when a page opens. It says whether we have
 *  checked this post and this author yet, offers the request and follow
 *  buttons, and fades away after a few seconds so it never becomes furniture. */
export function StatusOverlay({ noun, checked, authorCovered, request, follow }: StatusOverlayProps) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hideAfter = (ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), ms);
  };

  useEffect(() => {
    hideAfter(AUTO_HIDE_MS);
    return () => clearTimeout(timer.current);
  }, []);

  if (!visible) return null;
  return (
    <div
      className="w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={() => hideAfter(AUTO_HIDE_MS)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {checked ? checkedLine(noun, checked.noteCount) : `We haven't checked this ${noun} yet.`}
        </p>
        <button
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          ✕
        </button>
      </div>
      {!checked && authorCovered && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">We have checked other posts by this author.</p>
      )}
      {!checked && !authorCovered && follow && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">We haven't checked this author yet.</p>
      )}
      <div className="mt-2 space-y-2">
        {request && <ActionButton action={request} onDone={() => hideAfter(DONE_HIDE_MS)} />}
        {follow && <ActionButton action={follow} onDone={() => hideAfter(DONE_HIDE_MS)} />}
      </div>
    </div>
  );
}
