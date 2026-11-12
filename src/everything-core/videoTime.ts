/** Times in a video, as readers see them and as a reader's note on a video
 *  stores them. */

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** The longest stretch of a video one reader's note may cover. Migration 178
 *  enforces the same limit in the database. */
export const MAX_VIDEO_NOTE_SECONDS = 120;

/** A time in the video as YouTube writes it, such as 4:05 or 1:02:03. */
export function formatVideoTime(totalSeconds: number): string {
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = String(whole % SECONDS_PER_MINUTE).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
