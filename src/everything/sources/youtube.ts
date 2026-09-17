import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { fetchTimedTranscript, listOriginalSubtitleLanguages, type SubtitleCue } from "../../pipeline/media/ytDlpDownload";
import type { FetchedContent } from "../types";
import { fetchVideo } from "./youtubeDataApi";

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

/** English is asked for first, because everything downstream of the transcript
 *  is written in English. The `.*` picks up the regional spellings (`en-US`) and
 *  the marker YouTube puts on an original English track (`en-orig`). */
const PREFERRED_TRANSCRIPT_LANG = "en.*";

/** How many of the video's own tracks are fetched when English is missing. They
 *  go in one call and we keep the first that parses. A video rarely has more
 *  than one original track, and every extra one is paid proxy traffic. */
const MAX_FALLBACK_LANGUAGES = 3;

/** Fetch the video's timestamped cues. The temporary directory is always
 *  removed afterwards. This throws "No transcript available" when YouTube
 *  answered and the video has no captions. When YouTube could not be reached
 *  at all, the fetchers throw a YoutubeUnreachableError instead, so that a
 *  proxy outage is reported as one and the item is retried rather than
 *  recorded as caption-less (GOO-169).
 *
 *  A video that is not in English has no English track at all, and its machine
 *  translations are throttled hard enough by YouTube to be unusable, so we fall
 *  back to the language the video is actually in. The claims then come out in
 *  that language, which is the right thing anyway: the note is read by the
 *  people watching the video. Listing the languages costs an extra call, so it
 *  only happens once English has come back empty. */
async function fetchCues(url: string): Promise<SubtitleCue[]> {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "cn-yt-subs-"));
  try {
    const english = await fetchTimedTranscript(url, dir, PREFERRED_TRANSCRIPT_LANG);
    if (english?.length) return english;

    const languages = (await listOriginalSubtitleLanguages(url)).slice(0, MAX_FALLBACK_LANGUAGES);
    const own = languages.length ? await fetchTimedTranscript(url, dir, languages.join(",")) : null;
    if (own?.length) return own;
    throw new Error(`No transcript available for ${url}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function fetchYoutubeContent(url: string): Promise<FetchedContent> {
  const meta = await fetchVideo(url);
  if (meta.upcoming) throw new Error(`${url} is a premiere that has not aired yet`);
  return { kind: "youtube", url, videoId: meta.videoId, title: meta.title, publishedAt: meta.publishedAt, cues: await fetchCues(url), authorName: meta.channelTitle };
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
    cues: await fetchCues(url),
    authorName: meta.channelTitle,
  };
}
