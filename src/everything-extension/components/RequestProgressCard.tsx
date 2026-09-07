import { useEffect, useState } from "react";
import { progressLines, type RequestProgress } from "../../everything-shared/requestProgress";
import { IconButton } from "../../everything-web/src/components/IconButton";

/** How long the finished card lingers before fading out on its own. Hovering
 *  holds it, so a reader reading the count never loses it mid-look. */
const DONE_LINGER_MS = 6_000;
const FADE_MS = 700;

/** The circle itself. FLOATING_CARD is not reused here because its rounded-xl
 *  would fight the rounded-full this needs; the colors and shadow match it. */
const CIRCLE =
  "flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900";

const EXPANDED_CARD =
  "flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900";

function CircleContent({ progress }: { progress: RequestProgress }) {
  if (progress.kind === "done") {
    return <span className="text-base font-semibold text-green-700 dark:text-green-400">✓</span>;
  }
  if (progress.kind === "failed") {
    return <span className="text-base font-semibold text-red-600 dark:text-red-400">!</span>;
  }
  if (progress.kind === "unavailable") {
    return <span className="text-base font-semibold text-gray-400 dark:text-gray-500">?</span>;
  }
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 dark:border-gray-600 dark:border-t-blue-400"
    />
  );
}

/** The live-progress card for a note request. Collapsed it is nothing but a
 *  small circle: a spinner while work runs, a check mark when it is done.
 *  Hovering opens the terse readout, one fact per line. Clicking the finished
 *  circle jumps to the first note. Dismissing removes only the card; the
 *  request keeps running server-side. */
export function RequestProgressCard(props: {
  progress: RequestProgress;
  onJump?: () => void;
  onDismiss: () => void;
}) {
  const { progress, onJump, onDismiss } = props;
  const [expanded, setExpanded] = useState(false);
  const [fading, setFading] = useState(false);

  // The finished card fades out by itself after a moment. The timer only runs
  // while the reader is not hovering, and leaving restarts it.
  useEffect(() => {
    if (progress.kind !== "done" || expanded) return;
    const linger = setTimeout(() => setFading(true), DONE_LINGER_MS);
    return () => clearTimeout(linger);
  }, [progress.kind, expanded]);

  useEffect(() => {
    if (!fading) return;
    const gone = setTimeout(onDismiss, FADE_MS);
    return () => clearTimeout(gone);
  }, [fading, onDismiss]);

  const jumpable = progress.kind === "done" && onJump;
  const circle = jumpable ? (
    <button type="button" aria-label="Jump to the first note" title="Jump to the first note" className={`${CIRCLE} cursor-pointer`} onClick={onJump}>
      <CircleContent progress={progress} />
    </button>
  ) : (
    <div className={CIRCLE}>
      <CircleContent progress={progress} />
    </div>
  );

  return (
    <div
      className={`transition-opacity ease-out ${fading ? "opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      onMouseEnter={() => {
        setExpanded(true);
        setFading(false);
      }}
      onMouseLeave={() => setExpanded(false)}
    >
      {expanded ? (
        <div className={EXPANDED_CARD}>
          {circle}
          <div className="min-w-[8rem] pt-0.5 text-sm text-gray-900 dark:text-gray-100">
            {progressLines(progress).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <IconButton label="Dismiss" className="ml-auto" onClick={onDismiss}>
            ✕
          </IconButton>
        </div>
      ) : (
        circle
      )}
    </div>
  );
}
