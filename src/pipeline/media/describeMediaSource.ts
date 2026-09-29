/**
 * Describes a media URL that a note cites as its source, for the source
 * verifier.
 *
 * A YouTube video takes its details from the Data API and its transcript from
 * its captions. A video of 10 minutes or less is also downloaded at 360p
 * without its sound, and a few of its frames are described. A longer one is
 * not downloaded at all. Every byte of a YouTube download goes through the
 * paid residential proxy, and on 2026-09-29 the download of an hour-long
 * video did not finish within yt-dlp's time limit.
 *
 * Any other URL goes through yt-dlp, and through gallery-dl when yt-dlp fails,
 * which covers the Facebook, Instagram, Reddit, Tumblr and Imgur image posts
 * that yt-dlp cannot extract. A video of 10 minutes or less is downloaded at
 * 360p, with its sound only when Whisper will transcribe it. A longer video is
 * described by its details alone. If both tools fail this throws, and the
 * caller falls back to fetchWebPage.
 */

import { tmpdir } from "os";
import { join } from "path";
import { readFile, rm, mkdir } from "fs/promises";
import { extractYoutubeVideoId } from "../../everything-core/pageUrls";
import { addWarning } from "../utils/warnings";
import { analyzeVideo, describeImage, type GeminiMediaItem } from "./mediaAnalysisGemini";
import { downloadMediaWithYtDlp, fetchYtDlpMetadata, type VideoDownload, type YtDlpMetadata } from "./ytDlpDownload";
import { downloadWithGalleryDl } from "./galleryDlDownload";
import { captionsToText, fetchYoutubeCaptions, YoutubeUnreachableError } from "./youtubeCaptions";
import { fetchVideo } from "./youtubeDataApi";

/** The longest video we download. */
const MAX_DOWNLOAD_DURATION_MS = 600_000;

/** The longest video whose sound Whisper transcribes, when it has no captions
 *  we can fetch. Up to this length a transcript costs about a cent. */
const WHISPER_MAX_DURATION_MS = 300_000;

/** How much of an error goes into a run warning. */
const MAX_WARNING_REASON_LENGTH = 150;

type VideoStrategy = "full_video" | "frames";

/** What the platform tells us about the media, apart from its content. */
export interface MediaSourceDetails {
  title?: string;
  uploader?: string;
  /** An ISO date, or an ISO date and time. */
  published?: string;
  /** What the uploader wrote under the media. */
  description?: string;
}

export type MediaSourceDescription =
  | { kind: "image"; details: MediaSourceDetails; analysis: GeminiMediaItem }
  | { kind: "video"; details: MediaSourceDetails; analysis: GeminiMediaItem }
  /** A video too long to download. Only a YouTube video has a transcript. */
  | { kind: "video_too_long"; details: MediaSourceDetails; transcript: string | null };

export async function describeMediaFromUrl(url: string, costName: string, strategy: VideoStrategy = "frames"): Promise<MediaSourceDescription> {
  if (extractYoutubeVideoId(url)) return describeYoutubeVideo(url, costName, strategy);
  try {
    return await describeWithYtDlp(url, costName, strategy);
  } catch (ytErr: any) {
    try {
      return await describeWithGalleryDl(url, costName);
    } catch (gdlErr: any) {
      throw new Error(`yt-dlp failed (${ytErr?.message ?? ytErr}); gallery-dl failed (${gdlErr?.message ?? gdlErr})`);
    }
  }
}

async function describeYoutubeVideo(url: string, costName: string, strategy: VideoStrategy): Promise<MediaSourceDescription> {
  const video = await fetchVideo(url);
  const details = { title: video.title, uploader: video.channelTitle, published: video.publishedAt, description: video.description };
  const transcript = await fetchCaptionText(url);
  // A live stream has no duration yet, and is too long to download too.
  const durationMs = video.durationSeconds === null ? undefined : video.durationSeconds * 1000;
  if (durationMs === undefined || durationMs > MAX_DOWNLOAD_DURATION_MS) return { kind: "video_too_long", details, transcript };
  return { details, ...(await downloadAndDescribe(url, costName, strategy, { download: "pictures_only", durationMs, transcript })) };
}

/** The captions as plain text, or null when the video has none. When YouTube
 *  could not be reached, the video is still described from its details and
 *  frames, and the run carries a warning. A verifier that sees the title and
 *  the pictures can judge more than one that falls back to YouTube's page. */
async function fetchCaptionText(url: string): Promise<string | null> {
  try {
    const cues = await fetchYoutubeCaptions(url);
    return cues ? captionsToText(cues) : null;
  } catch (err) {
    if (!(err instanceof YoutubeUnreachableError)) throw err;
    addWarning(`YouTube captions could not be fetched, described without a transcript (${url}): ${err.message.slice(0, MAX_WARNING_REASON_LENGTH)}`);
    return "(the captions could not be fetched)";
  }
}

async function describeWithYtDlp(url: string, costName: string, strategy: VideoStrategy): Promise<MediaSourceDescription> {
  const meta = await fetchYtDlpMetadata(url);
  const details = detailsFromYtDlp(meta);
  const durationMs = meta.duration ? Math.round(meta.duration * 1000) : undefined;
  if (durationMs !== undefined && durationMs > MAX_DOWNLOAD_DURATION_MS) return { kind: "video_too_long", details, transcript: null };
  return { details, ...(await downloadAndDescribe(url, costName, strategy, planForDuration(durationMs))) };
}

/** Without a duration the URL may be an image post, and yt-dlp picks the file
 *  itself. A video up to WHISPER_MAX_DURATION_MS keeps its sound, which Whisper
 *  transcribes. A longer one gets no transcript, so its sound is not
 *  downloaded. */
function planForDuration(durationMs: number | undefined): DownloadPlan {
  if (durationMs === undefined) return { durationMs };
  if (durationMs <= WHISPER_MAX_DURATION_MS) return { download: "with_sound", durationMs };
  return { download: "pictures_only", durationMs, transcript: null };
}

async function describeWithGalleryDl(url: string, costName: string): Promise<MediaSourceDescription> {
  return withTempDir("cn-gdl-media", async (dir) => {
    const analysis = await describeImageFromLocalFile(downloadWithGalleryDl(url, dir), costName);
    return { kind: "image", details: {}, analysis };
  });
}

/** How to download and describe one file. `transcript` is the analyzeVideo
 *  argument of the same name: left out, Whisper transcribes the sound. */
interface DownloadPlan {
  download?: VideoDownload;
  durationMs: number | undefined;
  transcript?: string | null;
}

async function downloadAndDescribe(
  url: string,
  costName: string,
  strategy: VideoStrategy,
  plan: DownloadPlan,
): Promise<{ kind: "image" | "video"; analysis: GeminiMediaItem }> {
  return withTempDir("cn-yt-media", async (dir) => {
    const { filePath, kind } = await downloadMediaWithYtDlp(url, dir, plan.download);
    if (!filePath || !kind) throw new Error(`yt-dlp produced no usable file for ${url}`);
    if (kind === "image") return { kind, analysis: await describeImageFromLocalFile(filePath, costName) };
    return { kind, analysis: await analyzeVideo(filePath, plan.durationMs, costName, strategy, plan.transcript) };
  });
}

function detailsFromYtDlp(meta: YtDlpMetadata): MediaSourceDetails {
  return {
    title: meta.title,
    uploader: meta.uploader,
    published: meta.timestamp ? new Date(meta.timestamp * 1000).toISOString() : undefined,
    description: meta.description,
  };
}

async function withTempDir<T>(prefix: string, work: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function imageMimeFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "heic": return "image/heic";
    case "avif": return "image/avif";
    default: return "image/jpeg";
  }
}

async function describeImageFromLocalFile(filePath: string, costName: string): Promise<GeminiMediaItem> {
  const bytes = await readFile(filePath);
  return describeImage({ mimeType: imageMimeFromPath(filePath), data: bytes.toString("base64") }, filePath, costName);
}
