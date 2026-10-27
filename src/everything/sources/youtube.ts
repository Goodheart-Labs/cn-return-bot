import { execSync } from "child_process";
import { fetchYoutubeCaptions, type SubtitleCue } from "../../pipeline/media/youtubeCaptions";
import type { FetchedContent } from "../types";
import { fetchVideo, type YoutubeVideo } from "../../pipeline/media/youtubeDataApi";
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

/** How old a video must be before we believe it will never get captions.
 *  WebSub lets us try a video minutes after upload, before YouTube has made
 *  its automatic captions. In October 2026, 14 of 24 videos that had no
 *  captions in their first hour got them later. Of 66 videos older than a
 *  day, 1 did (GOO-422). */
const CAPTIONS_GRACE_HOURS = 24;

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
    why?: string,
  ) {
    super(`${url}: ${reason}${captionsMayStillCome ? ", but the video is young enough to still get captions" : ""}${why ? `. ${why}` : ""}`);
    this.name = "UnreadableVideoError";
  }
}

const ageHours = (publishedAt: string): number => (Date.now() - new Date(publishedAt).getTime()) / 3600_000;

/** The video's timestamped cues. This throws an UnreadableVideoError when
 *  YouTube answered that there is nothing we can read, and a
 *  YoutubeUnreachableError when YouTube could not be reached, so that a proxy
 *  outage is retried rather than recorded as a video without captions. */
async function fetchCues(video: YoutubeVideo): Promise<SubtitleCue[]> {
  const captions = await fetchYoutubeCaptions(video);
  if (captions.kind === "captions") return captions.cues;
  if (captions.kind === "age_restricted") throw new UnreadableVideoError(video.url, "age-restricted", false);
  throw new UnreadableVideoError(video.url, "no captions", ageHours(video.publishedAt) < CAPTIONS_GRACE_HOURS, captions.why);
}

export async function fetchYoutubeContent(url: string): Promise<FetchedContent> {
  const meta = await fetchVideo(url);
  if (meta.upcoming) throw new Error(`${url} is a premiere that has not aired yet`);
  return { kind: "youtube", url, videoId: meta.videoId, title: meta.title, publishedAt: meta.publishedAt, cues: await fetchCues(meta), authorName: meta.channelTitle };
}

/** The claims are extracted from a transcript the caller supplies. We still
 *  fetch the video's own cues, so that each claim's timestamp snaps onto them. */
export async function fetchYoutubeTranscriptContent(url: string, transcriptText: string): Promise<FetchedContent> {
  const meta = await fetchVideo(url);
  return {
    kind: "youtube-transcript",
    url,
    videoId: meta.videoId,
    title: meta.title,
    publishedAt: meta.publishedAt,
    text: transcriptText,
    cues: await fetchCues(meta),
    authorName: meta.channelTitle,
  };
}
