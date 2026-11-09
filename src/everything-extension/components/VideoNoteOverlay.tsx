import { useState, type ReactNode } from "react";
import { formatVideoTime } from "@cn/core/videoTime";
import { IconButton } from "@cn/ui/IconButton";
import { MinusIcon, PlusIcon } from "@cn/ui/icons";
import { defaultRange, moveRangeEdge, RANGE_STEP_SECONDS, type VideoRange } from "../utils/videoNoteRange";
import { EventShield } from "./EventShield";
import { WriteNoteOverlay } from "./WriteNoteOverlay";

const EDGE_NAMES = { start: "Start", end: "End" } as const;

/** One end of the range: its time between a button that moves it earlier and
 *  one that moves it later. A button that cannot move the end is disabled. */
function RangeEdge({ range, edge, durationSeconds, onChange }: {
  range: VideoRange;
  edge: "start" | "end";
  durationSeconds: number;
  onChange: (range: VideoRange) => void;
}) {
  const seconds = edge === "start" ? range.startSeconds : range.endSeconds;
  const moved = (delta: number) => moveRangeEdge(range, edge, delta, durationSeconds);
  const button = (delta: number, label: string, icon: ReactNode) => {
    const next = moved(delta);
    const blocked = (edge === "start" ? next.startSeconds : next.endSeconds) === seconds;
    return <IconButton label={label} disabled={blocked} onClick={() => onChange(next)}>{icon}</IconButton>;
  };
  return (
    <span className="inline-flex items-center gap-0.5">
      {button(-RANGE_STEP_SECONDS, `${EDGE_NAMES[edge]} ${RANGE_STEP_SECONDS} seconds earlier`, <MinusIcon size={14} aria-hidden />)}
      <span className="min-w-[3.5ch] text-center font-semibold tabular-nums text-fg">{formatVideoTime(seconds)}</span>
      {button(RANGE_STEP_SECONDS, `${EDGE_NAMES[edge]} ${RANGE_STEP_SECONDS} seconds later`, <PlusIcon size={14} aria-hidden />)}
    </span>
  );
}

/** The note editor for a stretch of a YouTube video. The stretch starts a
 *  little before the moment the reader asked to write, and the reader moves
 *  either end with the buttons. A note on a video quotes no captions, so the
 *  range is all it is tied to. The video's item is looked up or created only
 *  when the note is posted. */
export function VideoNoteOverlay({ videoId, atSeconds, durationSeconds, page, onClose, onPosted }: {
  videoId: string;
  atSeconds: number;
  durationSeconds: number;
  page: { url: string; title: string; creatorFeedUrl: Promise<string | null> };
  onClose: () => void;
  onPosted: () => void;
}) {
  const [range, setRange] = useState(() => defaultRange(atSeconds));
  return (
    <EventShield>
      <WriteNoteOverlay item={null} pageForItem={page} anchor={{ kind: "video", videoId, ...range }} onClose={onClose} onPosted={onPosted}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
          From
          <RangeEdge range={range} edge="start" durationSeconds={durationSeconds} onChange={setRange} />
          to
          <RangeEdge range={range} edge="end" durationSeconds={durationSeconds} onChange={setRange} />
        </p>
      </WriteNoteOverlay>
    </EventShield>
  );
}
