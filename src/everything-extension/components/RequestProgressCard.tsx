import { useEffect, useRef, useState } from "react";
import { progressLines, type RequestProgress } from "../../everything-shared/requestProgress";
import { IconButton } from "../../everything-web/src/components/IconButton";

/** How long the finished card lingers before fading out on its own. An opened
 *  card holds it, so a reader reading the count never loses it mid-look. */
const DONE_LINGER_MS = 6_000;
const FADE_MS = 700;

/** The disc the collapsed badge sits on. It exists only to keep the glyph
 *  legible over whatever the page puts behind it, so it has no outline of its
 *  own and only a soft shadow. Together with the trackless spinner that leaves
 *  exactly one circle on screen: the turning arc. */
const BADGE = "flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md dark:bg-gray-900";

const EXPANDED_CARD =
  "flex cursor-pointer items-center gap-3 rounded-xl bg-white p-3 shadow-lg ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10";

/** How far the pointer may travel between pressing and releasing and still
 *  count as a click. Anything further is a drag, which is how a reader selects
 *  the text in the card, and a drag must never close what it was reading. */
const DRAG_SLOP_PX = 4;

/** The one glyph that says how the request stands: a spinner while work runs,
 *  and a single character once it stopped. */
function ProgressGlyph({ progress }: { progress: RequestProgress }) {
  if (progress.kind === "done") {
    return <span className="text-base font-semibold text-green-700 dark:text-green-400">✓</span>;
  }
  if (progress.kind === "failed") {
    return <span className="text-base font-semibold text-red-600 dark:text-red-400">!</span>;
  }
  if (progress.kind === "unavailable") {
    return <span className="text-base font-semibold text-gray-400 dark:text-gray-500">?</span>;
  }
  // The unfilled part of the ring is transparent rather than grey, so a reader
  // sees one turning arc instead of an arc drawn on top of a second circle.
  return (
    <span
      aria-hidden
      className="h-5 w-5 animate-spin rounded-full border-2 border-transparent border-t-blue-600 dark:border-t-blue-400"
    />
  );
}

/** The live-progress card for a note request. Collapsed it is nothing but a
 *  small badge: a spinner while work runs, a check mark when it is done.
 *  Clicking it opens the terse readout, one fact per line, and clicking
 *  anywhere on the open card closes it again. Selecting the text does not,
 *  because a drag is not a click. When notes were written the readout doubles
 *  as the jump link. Dismissing removes only the card; the request keeps
 *  running. */
export function RequestProgressCard(props: {
  progress: RequestProgress;
  onJump?: () => void;
  onDismiss: () => void;
}) {
  const { progress, onJump, onDismiss } = props;
  const [expanded, setExpanded] = useState(false);
  const [fading, setFading] = useState(false);

  // The finished card fades out by itself after a moment. The timer only runs
  // while the card is collapsed, so an opened readout stays until it is closed
  // or dismissed.
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

  const lines = progressLines(progress);
  const jumpable = progress.kind === "done" && progress.notes > 0 && onJump;

  // Where the press started, so the release can tell a click from a drag.
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const collapseUnlessDragging = (event: React.MouseEvent) => {
    const from = pressedAt.current;
    pressedAt.current = null;
    if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG_SLOP_PX) return;
    if (window.getSelection()?.toString()) return;
    setExpanded(false);
  };

  return (
    <div
      className={`transition-opacity ease-out ${fading ? "opacity-0" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      {expanded ? (
        <div
          className={EXPANDED_CARD}
          onPointerDown={(event) => {
            pressedAt.current = { x: event.clientX, y: event.clientY };
          }}
          onClick={collapseUnlessDragging}
        >
          {/* The glyph is the control a keyboard reaches. The surface around it
              does the same thing for a mouse, which is why its click bubbles
              here rather than being handled twice. */}
          <button type="button" aria-label="Hide the details" className="flex h-5 w-5 items-center justify-center">
            <ProgressGlyph progress={progress} />
          </button>
          <div className="min-w-[8rem] text-sm text-gray-900 dark:text-gray-100">
            {jumpable ? (
              <button
                type="button"
                className="text-left underline-offset-2 hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  onJump!();
                }}
                title="Jump to the first note"
              >
                {lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </button>
            ) : (
              lines.map((line) => <p key={line}>{line}</p>)
            )}
          </div>
          <IconButton
            label="Dismiss"
            className="ml-auto"
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
          >
            ✕
          </IconButton>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Show what the requested check is doing"
          className={BADGE}
          onClick={() => {
            setExpanded(true);
            setFading(false);
          }}
        >
          <ProgressGlyph progress={progress} />
        </button>
      )}
    </div>
  );
}
