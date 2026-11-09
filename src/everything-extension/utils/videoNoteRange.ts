import { MAX_VIDEO_NOTE_SECONDS } from "@cn/core/videoTime";

/** The stretch of a video a reader's note is about, in whole seconds. */
export interface VideoRange {
  startSeconds: number;
  endSeconds: number;
}

/** A new note's range starts this long before the moment the reader asked to
 *  write, because people react after they hear the sentence. */
const DEFAULT_LOOKBACK_SECONDS = 10;
/** How far one press of a range button moves an end. */
export const RANGE_STEP_SECONDS = 5;
/** The database refuses a range whose end is not after its start. */
const MIN_RANGE_SECONDS = 1;

/** The range a new note starts with: from a little before `atSeconds` up to
 *  it, never before the video's start. */
export function defaultRange(atSeconds: number): VideoRange {
  const endSeconds = Math.max(Math.floor(atSeconds), MIN_RANGE_SECONDS);
  return { startSeconds: Math.max(0, endSeconds - DEFAULT_LOOKBACK_SECONDS), endSeconds };
}

/** Moves one end of the range by `deltaSeconds`. The end stops where the
 *  range would turn empty, grow past the longest allowed range, or leave the
 *  video. So a move that is not possible returns the range unchanged. */
export function moveRangeEdge(range: VideoRange, edge: "start" | "end", deltaSeconds: number, durationSeconds: number): VideoRange {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  if (edge === "start") {
    const earliest = Math.max(0, range.endSeconds - MAX_VIDEO_NOTE_SECONDS);
    return { ...range, startSeconds: clamp(range.startSeconds + deltaSeconds, earliest, range.endSeconds - MIN_RANGE_SECONDS) };
  }
  const latest = Math.min(range.startSeconds + MAX_VIDEO_NOTE_SECONDS, Math.floor(durationSeconds));
  return { ...range, endSeconds: clamp(range.endSeconds + deltaSeconds, range.startSeconds + MIN_RANGE_SECONDS, latest) };
}
