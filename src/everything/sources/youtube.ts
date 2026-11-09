import { execSync } from "child_process";
import type { UnreadableVideoReason } from "../../everything-core/requestProgress";

/** yt-dlp is needed for exactly one thing here: the captions. Everything else
 *  about a video or a channel comes from the Data API (youtubeDataApi.ts). */
export function ensureYtDlp(): void {
  try {
    execSync("yt-dlp --version", { stdio: "pipe" });
  } catch {
    console.error("yt-dlp is not installed. Install with: brew install yt-dlp");
    process.exit(1);
  }
}

/** YouTube answered, and what it said means we cannot read the video. The
 *  item is then not a failure. The worker records it as done with `reason` as
 *  its skip reason, except that a video young enough to still get captions is
 *  tried again first. The extension's progress card reads the reason to tell
 *  a reader who requested the video why nothing was checked. `why` explains
 *  the reason in the run log, for example which step found no captions. */
export class UnreadableVideoError extends Error {
  constructor(
    url: string,
    readonly reason: UnreadableVideoReason,
    readonly captionsMayStillCome: boolean,
    readonly why?: string,
  ) {
    super(`${url}: ${reason}${captionsMayStillCome ? ", but the video is young enough to still get captions" : ""}${why ? `. ${why}` : ""}`);
    this.name = "UnreadableVideoError";
  }
}
