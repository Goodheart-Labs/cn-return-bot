/**
 * Gemini 3 Flash Media Analysis
 *
 * Analyzes tweet media using Gemini 3 Flash via the native Google Gen AI API
 * (so it shares the free→paid key routing in ../llm/gemini).
 * - Images: direct vision call with structured JSON (description + OCR)
 * - Short videos (<= 3.5 min): pass entire video as inline base64 bytes
 * - Frame-sampled videos: extract 5 equally-spaced frames across the clip via
 *   ffmpeg (works for any length, including sub-5s clips)
 * - Audio: extract and transcribe with Groq Whisper
 */

import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { readFile, writeFile, rm, mkdir, stat } from "fs/promises";
import { getTweetLog } from "../utils/tweetLog";
import { addWarning } from "../utils/warnings";
import { GEMINI_MODEL } from "../cost-tracking/pricing";
import { trackLlmCall } from "../cost-tracking/costTracker";
import { geminiNativeGenerate, type GeminiContentPart } from "../llm/gemini";
import {
  downloadVideoWithYtDlp,
  fetchAutoSubs,
  fetchYtDlpMetadata,
  type YtDlpKind,
  type YtDlpMetadata,
} from "./ytDlpDownload";
import { downloadWithGalleryDl } from "./galleryDlDownload";
import { IMAGE_PROMPT, VIDEO_PROMPT, FRAME_PROMPT } from "../prompts/media/mediaAnalysis";
import { getBestMediaUrl } from "./bestMediaUrl";

const execAsync = promisify(exec);
// Native Gemini API takes the model id without the OpenRouter "google/" prefix.
const GEMINI_NATIVE_MODEL = GEMINI_MODEL.replace(/^google\//, "");
const FRAME_SAMPLE_COUNT = 5;              // equally-spaced frames sent for frame-sampled videos
const LONG_VIDEO_THRESHOLD_MS = 210_000;   // 3.5 minutes — short videos go to Gemini whole; long videos get frame sampling
const AUTO_SUBS_THRESHOLD_MS = 300_000;    // 5 minutes — above this we use auto-subs as the transcript and never run Whisper
const LOW_QUALITY_THRESHOLD_MS = 900_000;  // 15 minutes — above this we request the lowest-resolution stream to cap download bytes

// --- Types ---

export interface GeminiMediaDescription {
  description: string;
  ocrText: string;
}

export interface GeminiMediaItem {
  type: "image" | "video";
  url: string;
  description: GeminiMediaDescription;
  transcription?: string;
}

export interface GeminiMediaResult {
  tweetMedia: GeminiMediaItem[];
  quotedTweetMedia: GeminiMediaItem[];
}

// Entities X tagged on the post (people, orgs, topics) — given to Gemini as a hint
// to identify who/what is shown, since vision models often can't name people unaided.
function entityHint(entities?: string[]): string {
  if (!entities?.length) return "";
  return `\n\nThe post is tagged with these entities (may appear in the media): ${entities.join(", ")}`;
}

// Gemini-flavoured schema (uppercase types) for the native responseSchema.
const MEDIA_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    description: { type: "STRING", description: "A factual description of the media content" },
    ocr_text: { type: "STRING", description: "All visible text, quoted exactly. Empty string if none." },
  },
  required: ["description", "ocr_text"],
};

// --- Helpers ---

/** Readable view of the parts sent to a media call: text (prompt + entity hint)
 *  verbatim, binary parts as a `[media: mime, N b64 chars]` placeholder so the
 *  base64 bytes never bloat the log. */
function formatMediaParts(parts: GeminiContentPart[]): string {
  return parts
    .map((part) =>
      "text" in part
        ? part.text
        : `[media: ${part.inlineData.mimeType}, ${part.inlineData.data.length} b64 chars]`,
    )
    .join("\n");
}

/** One native-Gemini media call: send the parts, record cost, map the JSON.
 *  Logs input (prompt + entity hint + media placeholders) and output under the
 *  call's cost name so every media description's I/O is inspectable. */
async function analyzeMediaParts(parts: GeminiContentPart[], costName: string): Promise<GeminiMediaDescription> {
  const log = getTweetLog();
  log?.set(`${costName}.input`, formatMediaParts(parts));

  const result = await geminiNativeGenerate({
    model: GEMINI_NATIVE_MODEL,
    userParts: parts,
    responseSchema: MEDIA_RESPONSE_SCHEMA,
  });
  trackLlmCall({ name: costName, ...result.cost, tools: [] });

  const parsed = result.parsed;
  const description: GeminiMediaDescription = parsed
    ? { description: parsed.description ?? "", ocrText: parsed.ocr_text ?? "" }
    : { description: "", ocrText: "" };
  log?.set(`${costName}.output`, description);
  return description;
}

async function fetchImageInlineData(imageUrl: string): Promise<{ mimeType: string; data: string }> {
  const dataUrlMatch = /^data:([^;]+);base64,(.*)$/s.exec(imageUrl);
  if (dataUrlMatch) return { mimeType: dataUrlMatch[1]!, data: dataUrlMatch[2]! };

  const response = await fetch(imageUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { mimeType, data: bytes.toString("base64") };
}

// --- Audio transcription (reusing Groq Whisper pattern) ---

async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) return "";

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/mp3" }), "audio.mp3");
  formData.append("model", "whisper-large-v3");
  formData.append("response_format", "text");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} ${errorText}`);
  }

  return (await response.text()).trim();
}

// --- Image analysis ---

async function describeImage(
  inline: { mimeType: string; data: string },
  url: string,
  costName: string,
  entities?: string[],
): Promise<GeminiMediaItem> {
  const description = await analyzeMediaParts(
    [{ text: IMAGE_PROMPT + entityHint(entities) }, { inlineData: inline }],
    costName,
  );
  return { type: "image", url, description };
}

async function describeImageFromUrl(imageUrl: string, costName: string, entities?: string[]): Promise<GeminiMediaItem> {
  return describeImage(await fetchImageInlineData(imageUrl), imageUrl, costName, entities);
}

// --- Video analysis ---

async function downloadVideo(videoUrl: string, tmpDir: string): Promise<string> {
  const videoPath = join(tmpDir, "video.mp4");
  const response = await fetch(videoUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
  await writeFile(videoPath, Buffer.from(await response.arrayBuffer()));
  return videoPath;
}

/** True iff the clip carries an audio stream. Silent videos (common on X) make
 *  the audio-extraction ffmpeg call error out, so we check first and skip it. */
async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${videoPath}"`,
      { timeout: 10000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function extractAudio(videoPath: string, tmpDir: string): Promise<string> {
  if (!(await hasAudioStream(videoPath))) return "";
  const audioPath = join(tmpDir, "audio.mp3");
  await execAsync(
    `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 "${audioPath}" -y 2>&1`,
    { timeout: 60000 },
  );
  const audioStat = await stat(audioPath);
  if (audioStat.size < 1000) return "";
  const audioBuffer = await readFile(audioPath);
  return transcribeAudio(audioBuffer);
}

async function analyzeShortVideo(videoPath: string, costName: string, entities?: string[]): Promise<GeminiMediaDescription> {
  const videoBytes = await readFile(videoPath);
  return analyzeMediaParts(
    [{ text: VIDEO_PROMPT + entityHint(entities) }, { inlineData: { mimeType: "video/mp4", data: videoBytes.toString("base64") } }],
    costName,
  );
}

/** ffprobe a clip's duration in seconds; null if it can't be determined. */
async function probeDurationSeconds(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { timeout: 10000 },
    );
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/** Extract FRAME_SAMPLE_COUNT equally-spaced frames across the whole clip and
 *  send them to Gemini. The sampling rate is derived from the duration
 *  (count / duration) so it works for any length — including sub-5s clips,
 *  which a fixed "1 frame per 5s" rate would miss entirely. */
async function analyzeVideoFrames(
  videoPath: string,
  tmpDir: string,
  costName: string,
  durationMs: number | undefined,
  entities?: string[],
): Promise<GeminiMediaDescription> {
  const durationSec =
    (durationMs && durationMs > 0 ? durationMs / 1000 : null) ?? (await probeDurationSeconds(videoPath));
  // count / duration spreads FRAME_SAMPLE_COUNT frames evenly over the clip.
  // Unknown duration → fall back to 1 fps (still yields frames; `-frames:v` caps).
  const fps = durationSec ? FRAME_SAMPLE_COUNT / durationSec : 1;

  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "fps=${fps},scale=640:-1" -frames:v ${FRAME_SAMPLE_COUNT} "${tmpDir}/frame%03d.jpg" -y 2>&1`,
    { timeout: 60000 },
  ).catch((err) => {
    console.error("[mediaAnalysisGemini] FFmpeg frame extraction error:", err.message);
  });

  const frameParts: GeminiContentPart[] = [];
  for (let i = 1; i <= FRAME_SAMPLE_COUNT; i++) {
    const framePath = join(tmpDir, `frame${String(i).padStart(3, "0")}.jpg`);
    try {
      const frameStat = await stat(framePath);
      if (frameStat.size > 0) {
        const frameData = await readFile(framePath);
        frameParts.push({ inlineData: { mimeType: "image/jpeg", data: frameData.toString("base64") } });
      }
    } catch {
      break;
    }
  }

  if (frameParts.length === 0) return { description: "", ocrText: "" };

  return analyzeMediaParts([{ text: FRAME_PROMPT + entityHint(entities) }, ...frameParts], costName);
}

let ffmpegAvailable: boolean | null = null;
async function checkFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execAsync("ffmpeg -version", { timeout: 5000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

function isLocalPath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("./") || p.startsWith("../");
}

async function analyzeVideo(
  videoUrl: string,
  durationMs: number | undefined,
  costName: string,
  strategy: "full_video" | "frames" = "frames",
  /**
   * Transcript decision made by the caller.
   * - undefined: caller didn't decide — extract audio + Whisper (default behavior).
   * - string: use this as the transcript verbatim (e.g. auto-subs).
   * - null: explicit "no transcript available, do NOT fall back to Whisper" (used for long videos to cap cost).
   */
  precomputedTranscript?: string | null,
  entities?: string[],
): Promise<GeminiMediaItem> {
  const isLocal = isLocalPath(videoUrl);
  const tmpDir = join(tmpdir(), `cn-gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await mkdir(tmpDir, { recursive: true });
    const videoPath = isLocal ? videoUrl : await downloadVideo(videoUrl, tmpDir);

    const useFrames = strategy === "frames"
      || (durationMs != null && durationMs > LONG_VIDEO_THRESHOLD_MS);

    let description: GeminiMediaDescription;
    if (useFrames) {
      if (!(await checkFfmpeg())) {
        console.warn("[mediaAnalysisGemini] FFmpeg not available, skipping frames");
        description = { description: "", ocrText: "" };
      } else {
        description = await analyzeVideoFrames(videoPath, tmpDir, costName, durationMs, entities);
      }
    } else {
      description = await analyzeShortVideo(videoPath, costName, entities);
    }

    const transcription = await resolveTranscription(videoPath, tmpDir, precomputedTranscript);

    return { type: "video", url: videoUrl, description, transcription };
  } catch (err: any) {
    console.error("[mediaAnalysisGemini] Video analysis failed:", err.message);
    addWarning(`Video analysis failed, no description (${videoUrl}): ${err.message?.slice(0, 150)}`);
    return { type: "video", url: videoUrl, description: { description: "", ocrText: "" }, };
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function resolveTranscription(
  videoPath: string,
  tmpDir: string,
  precomputed: string | null | undefined,
): Promise<string> {
  // Caller forced "no Whisper" — used for long videos where auto-subs are the only allowed transcript source.
  if (precomputed !== undefined) {
    return precomputed ?? "(no auto-subs available)";
  }
  if (!(await checkFfmpeg())) return "(ffmpeg unavailable)";
  try {
    const text = await extractAudio(videoPath, tmpDir);
    return text || "(no audio track)";
  } catch (err: any) {
    console.error("[mediaAnalysisGemini] Audio extraction failed:", err.message);
    return `(transcription failed: ${err.message?.slice(0, 100)})`;
  }
}

// --- Main entry point ---

async function analyzeMediaItems(
  mediaItems: any[],
  namePrefix: string,
  strategy: "full_video" | "frames" = "frames",
  entities?: string[],
): Promise<GeminiMediaItem[]> {
  if (!mediaItems?.length) return [];

  const results: GeminiMediaItem[] = [];

  const images = mediaItems.filter((m) => m.type === "photo");
  const videos = mediaItems.filter((m) => m.type === "video" || m.type === "animated_gif");

  let imageIdx = 0;
  const imageResults = await Promise.all(
    images
      .map((img) => getBestMediaUrl(img))
      .filter((url): url is string => !!url)
      .map((url) => describeImageFromUrl(url, `${namePrefix}.image.${imageIdx++}`, entities).catch((err) => {
        console.error("[mediaAnalysisGemini] Image analysis failed:", err.message);
        addWarning(`Image analysis failed, no description (${url}): ${err.message?.slice(0, 150)}`);
        return { type: "image" as const, url, description: { description: "", ocrText: "" } };
      })),
  );
  results.push(...imageResults);

  let videoIdx = 0;
  for (const video of videos) {
    const videoUrl = getBestMediaUrl(video);
    if (!videoUrl) continue;
    results.push(await analyzeVideo(videoUrl, video.duration_ms, `${namePrefix}.video.${videoIdx++}`, strategy, undefined, entities));
  }

  return results;
}

// --- External media URLs (used by source verifier) ---

export interface MediaSourceDescription {
  kind: YtDlpKind;
  meta: YtDlpMetadata;
  analysis: GeminiMediaItem;
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

/**
 * Cascading dispatch for cited media URLs:
 *   yt-dlp (videos + most image posts) → gallery-dl (Facebook / IG / Reddit
 *   / Tumblr / Imgur image posts that yt-dlp can't extract) → throw.
 * The caller catches the throw and falls back to handleWebFetch.
 *
 * For videos, the strategy adapts to duration to control cost:
 *   - ≥ 5 min: auto-subs only as the transcript; no Whisper fallback.
 *   - ≥ 15 min: download the lowest-resolution stream (frames are scaled
 *     to 640px anyway, so HD bytes are wasted).
 */
export async function describeMediaFromUrl(
  url: string,
  costName: string,
  strategy: "full_video" | "frames" = "frames",
): Promise<MediaSourceDescription> {
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

async function describeWithYtDlp(
  url: string,
  costName: string,
  strategy: "full_video" | "frames",
): Promise<MediaSourceDescription> {
  const meta = fetchYtDlpMetadata(url);
  const durationMs = meta.duration ? Math.round(meta.duration * 1000) : undefined;
  const isLongAudio = durationMs != null && durationMs > AUTO_SUBS_THRESHOLD_MS;
  const isLongVideo = durationMs != null && durationMs > LOW_QUALITY_THRESHOLD_MS;

  const tmpDir = join(tmpdir(), `cn-yt-media-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
  try {
    let precomputedTranscript: string | null | undefined;
    if (isLongAudio) {
      // Videos ≥ 5 min: auto-subs only. If they're missing, we accept "no
      // transcript" rather than running Whisper on hours of audio.
      precomputedTranscript = fetchAutoSubs(url, tmpDir, "en") ?? null;
    }

    const { filePath, kind } = downloadVideoWithYtDlp(url, tmpDir, meta, isLongVideo ? "low" : "default");
    if (!filePath || !kind) throw new Error(`yt-dlp produced no usable file for ${url}`);

    if (kind === "video") {
      const analysis = await analyzeVideo(filePath, durationMs, costName, strategy, precomputedTranscript);
      return { kind, meta, analysis };
    }
    const analysis = await describeImageFromLocalFile(filePath, costName);
    return { kind, meta, analysis };
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function describeWithGalleryDl(url: string, costName: string): Promise<MediaSourceDescription> {
  const tmpDir = join(tmpdir(), `cn-gdl-media-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
  try {
    const { meta, filePath } = downloadWithGalleryDl(url, tmpDir);
    if (!filePath) throw new Error(`gallery-dl produced no file for ${url}`);
    const analysis = await describeImageFromLocalFile(filePath, costName);
    return { kind: "image", meta, analysis };
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

export async function analyzeMediaGemini(
  tweetMedia?: any[],
  quotedTweetMedia?: any[],
  strategy: "full_video" | "frames" = "frames",
  entities?: string[],
): Promise<GeminiMediaResult> {
  const startMs = Date.now();
  const log = getTweetLog();

  const [tweetResults, quotedResults] = await Promise.all([
    analyzeMediaItems(tweetMedia ?? [], "media.tweet", strategy, entities),
    analyzeMediaItems(quotedTweetMedia ?? [], "media.quoted", strategy, entities),
  ]);

  log?.set("media.gemini.tweetMedia", tweetResults);
  log?.set("media.gemini.quotedTweetMedia", quotedResults);
  log?.set("media.gemini.durationMs", Date.now() - startMs);

  return {
    tweetMedia: tweetResults,
    quotedTweetMedia: quotedResults,
  };
}
