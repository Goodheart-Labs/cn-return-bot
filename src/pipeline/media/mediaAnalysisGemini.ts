/**
 * Gemini 3 Flash Media Analysis
 *
 * Analyzes tweet media with Gemini 3 Flash through the native Google Gen AI
 * API. Calling Google natively is what lets these calls share the free-key
 * first, paid-key second routing in ../llm/gemini.
 *
 * An image goes straight to a vision call that returns structured JSON with a
 * description and the text read off the image.
 * A video of 3.5 minutes or less is sent whole as inline base64 bytes.
 * Every other video is sampled into 5 equally-spaced frames with ffmpeg. That
 * path works for a clip of any length, including one under 5 seconds.
 * Audio is extracted from the video and transcribed by Groq Whisper.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { readFile, writeFile, rm, mkdir, stat } from "fs/promises";
import { getTweetLog } from "../utils/tweetLog";
import { addWarning } from "../utils/warnings";
import { GEMINI_MODEL } from "../cost-tracking/pricing";
import { trackLlmCall, trackedLlmCreate } from "../cost-tracking/costTracker";
import { stripJsonFences } from "../utils/jsonOutput";
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
// The vision model we fall back to when Gemini is unavailable, for example when
// it returns a 503 because demand is high. This call goes through OpenRouter,
// so it keeps working while Google's native API is overloaded.
const HAIKU_FALLBACK_MODEL = "anthropic/claude-haiku-4.5";
const FRAME_SAMPLE_COUNT = 5;              // How many frames we sample from a video, spaced evenly across it.
const LONG_VIDEO_THRESHOLD_MS = 210_000;   // 3.5 minutes. A video this long or shorter can be sent to Gemini whole.
const AUTO_SUBS_THRESHOLD_MS = 300_000;    // 5 minutes. Above this the transcript comes from auto-subs, and Whisper never runs.
const LOW_QUALITY_THRESHOLD_MS = 900_000;  // 15 minutes. Above this we ask for the lowest-resolution stream to limit download size.

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

// X tags a post with entities such as people, organisations and topics. We pass them
// to Gemini as a hint for working out who or what the media shows. Vision models are
// often unable to name a person without such a hint.
function entityHint(entities?: string[]): string {
  if (!entities?.length) return "";
  return `\n\nThe post is tagged with these entities (may appear in the media): ${entities.join(", ")}`;
}

// The native Gemini API expects a response schema whose type names are uppercase.
const MEDIA_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    description: { type: "STRING", description: "A factual description of the media content" },
    ocr_text: { type: "STRING", description: "All visible text, quoted exactly. Empty string if none." },
  },
  required: ["description", "ocr_text"],
};

// --- Helpers ---

/** Builds a readable view of the parts sent to a media call. Text parts, which are
 *  the prompt and the entity hint, are kept word for word. A binary part is replaced
 *  by a short placeholder naming its mime type and size. That keeps the base64 bytes
 *  out of the log. */
function formatMediaParts(parts: GeminiContentPart[]): string {
  return parts
    .map((part) =>
      "text" in part
        ? part.text
        : `[media: ${part.inlineData.mimeType}, ${part.inlineData.data.length} b64 chars]`,
    )
    .join("\n");
}

/** Makes one native Gemini media call. It sends the parts, records the cost and maps
 *  the JSON response. Both the input and the output are logged under the call's cost
 *  name, so every media description can be inspected afterwards. */
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

/** Describes an image with Claude Haiku through OpenRouter, for when the native Gemini
 *  call is unavailable. It sends the same prompt and asks for a JSON object, which is
 *  then mapped onto the shape Gemini would have returned. */
async function describeImageWithHaiku(
  inline: { mimeType: string; data: string },
  promptText: string,
  costName: string,
): Promise<GeminiMediaDescription> {
  const log = getTweetLog();
  log?.set(`${costName}.input`, promptText);

  const { response, costEntry } = await trackedLlmCreate(costName, {
    model: HAIKU_FALLBACK_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${promptText}\n\nRespond with JSON: {"description": string, "ocr_text": string}` },
          { type: "image_url", image_url: { url: `data:${inline.mimeType};base64,${inline.data}` } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  } as any);
  trackLlmCall(costEntry);

  const parsed = JSON.parse(stripJsonFences(response.choices?.[0]?.message?.content ?? "{}"));
  const description: GeminiMediaDescription = {
    description: parsed.description ?? "",
    ocrText: parsed.ocr_text ?? "",
  };
  log?.set(`${costName}.output`, description);
  return description;
}

/** Describes an image with Gemini vision, and falls back to Haiku when Gemini throws
 *  or returns nothing usable. A successful description is never empty. So an empty
 *  result counts as a Gemini failure and is retried on Haiku. */
async function describeImage(
  inline: { mimeType: string; data: string },
  url: string,
  costName: string,
  entities?: string[],
): Promise<GeminiMediaItem> {
  const promptText = IMAGE_PROMPT + entityHint(entities);

  try {
    const description = await analyzeMediaParts([{ text: promptText }, { inlineData: inline }], costName);
    if (description.description !== "") return { type: "image", url, description };
    // Gemini returned an empty description, so we fall through to Haiku.
  } catch (err: any) {
    console.error("[mediaAnalysisGemini] Gemini image analysis failed, falling back to Haiku:", err.message);
  }

  const description = await describeImageWithHaiku(inline, promptText, `${costName}.haiku`);
  addWarning(`Image analysis: Gemini failed, used Claude Haiku fallback (${url})`);
  return { type: "image", url, description };
}

export async function describeImageFromUrl(imageUrl: string, costName: string, entities?: string[]): Promise<GeminiMediaItem> {
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

/** Reports whether the clip carries an audio stream. Silent videos are common on X,
 *  and the ffmpeg audio-extraction call errors out on them. So we check first and skip
 *  the extraction when there is no audio. */
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

/** Returns the clip's duration in seconds as reported by ffprobe. Returns null when
 *  the duration cannot be determined. */
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

/** Extracts FRAME_SAMPLE_COUNT equally-spaced frames from across the whole clip and
 *  sends them to Gemini. The sampling rate is the frame count divided by the duration,
 *  so the frames spread evenly however long the clip is. A fixed rate of one frame
 *  every five seconds would miss a clip shorter than five seconds entirely. */
async function analyzeVideoFrames(
  videoPath: string,
  tmpDir: string,
  costName: string,
  durationMs: number | undefined,
  entities?: string[],
): Promise<GeminiMediaDescription> {
  const durationSec =
    (durationMs && durationMs > 0 ? durationMs / 1000 : null) ?? (await probeDurationSeconds(videoPath));
  // When the duration is unknown we sample one frame per second instead. That still
  // produces frames, and the -frames:v flag caps how many of them we keep.
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
   * The transcript decision the caller has already made.
   * When this is undefined the caller made no decision. We then extract the audio and
   * transcribe it with Whisper, which is the default behaviour.
   * When it is a string we use that string as the transcript, for example auto-subs.
   * When it is null the caller is saying no transcript is available and Whisper must
   * not run anyway. Long videos use this so the run stays cheap.
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
  // The caller already settled the transcript, so Whisper must not run. A long video
  // takes this path, because auto-subs are its only allowed transcript source.
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
        console.error("[mediaAnalysisGemini] Image analysis failed (Gemini + Haiku):", err.message);
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
 * Downloads and describes a media URL that a source cites. We try yt-dlp first,
 * which handles videos and most image posts. If yt-dlp fails we try gallery-dl,
 * which covers the Facebook, Instagram, Reddit, Tumblr and Imgur image posts that
 * yt-dlp cannot extract. If both fail this throws. The caller catches that error
 * and falls back to fetchWebPage.
 *
 * For a video the strategy adapts to its duration to keep the cost down.
 * A video longer than 5 minutes takes its transcript from auto-subs only, and never
 * falls back to Whisper.
 * A video longer than 15 minutes is downloaded at the lowest available resolution.
 * The frames we sample are scaled down to 640px anyway, so the extra bytes of an HD
 * stream would be wasted.
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
      // A video longer than 5 minutes takes its transcript from auto-subs only.
      // When it has none we accept having no transcript at all. Running Whisper
      // over hours of audio would cost far more than the transcript is worth.
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
