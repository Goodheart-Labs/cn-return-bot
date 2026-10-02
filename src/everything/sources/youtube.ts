import { execSync } from "child_process";
import { fetchYoutubeCaptions, type SubtitleCue } from "../../pipeline/media/youtubeCaptions";
import type { FetchedContent } from "../types";
import { fetchVideo, type YoutubeVideo } from "../../pipeline/media/youtubeDataApi";

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

/** The video's timestamped cues. This throws "No transcript available" when
 *  YouTube answered and the video has no captions, and a
 *  YoutubeUnreachableError when YouTube could not be reached, so that a proxy
 *  outage is retried rather than recorded as a video without captions. */
async function fetchCues(video: YoutubeVideo): Promise<SubtitleCue[]> {
  const cues = await fetchYoutubeCaptions(video);
  if (!cues) throw new Error(`No transcript available for ${video.url}`);
  return cues;
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
