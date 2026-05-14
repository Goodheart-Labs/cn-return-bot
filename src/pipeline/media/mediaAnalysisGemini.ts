/**
 * Gemini 3 Flash Media Analysis
 *
 * Analyzes tweet media using Gemini 3 Flash via OpenRouter.
 * - Images: direct vision call with structured JSON (description + OCR)
 * - Short videos (<= 3.5 min): pass entire video as base64 via video_url
 * - Long videos (> 3.5 min): extract 4 uniformly sampled frames via ffmpeg
 * - Audio: extract and transcribe with Groq Whisper
 */

import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { readFile, writeFile, rm, mkdir, stat } from "fs/promises";
import { getTweetLog } from "../utils/tweetLog";
import { GEMINI_MODEL } from "../cost-tracking/pricing";
import { trackLlmCall, trackedLlmCreate } from "../cost-tracking/costTracker";
import { downloadWithYtDlp, type YtDlpMetadata, type YtDlpKind } from "./ytDlpDownload";

const execAsync = promisify(exec);
const LONG_VIDEO_THRESHOLD_MS = 210_000; // 3.5 minutes

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

// --- Prompts ---

const IMAGE_PROMPT = `Analyze this image. Describe what it shows and extract all visible text.`;

const VIDEO_PROMPT = `Analyze this video. Describe what happens and extract all visible text.`;

const FRAME_PROMPT = `These are frames extracted from a video. Describe what happens per frame and extract all visible text per frame`;

const MEDIA_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "media_description",
    strict: true,
    schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "A factual description of the media content" },
        ocr_text: { type: "string", description: "All visible text, quoted exactly. Empty string if none." },
      },
      required: ["description", "ocr_text"],
      additionalProperties: false,
    },
  },
};

// --- Helpers ---

function parseMediaResponse(content: string): GeminiMediaDescription {
  const parsed = JSON.parse(content);
  return { description: parsed.description, ocrText: parsed.ocr_text };
}

function getBestUrl(item: {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: Array<{ bit_rate?: number; content_type: string; url: string }>;
}): string | undefined {
  if (item.type === "photo") return item.url || item.preview_image_url;
  if (item.variants?.length) {
    const mp4s = item.variants
      .filter((v) => v.content_type === "video/mp4")
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));
    if (mp4s[0]) return mp4s[0].url;
    return item.variants[0]?.url;
  }
  return item.url || item.preview_image_url;
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

export async function describeImageFromUrl(imageUrl: string, costName: string): Promise<GeminiMediaItem> {
  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: IMAGE_PROMPT },
        { type: "image_url" as const, image_url: { url: imageUrl } },
      ],
    },
  ];

  const { response, costEntry } = await trackedLlmCreate(costName, {
    model: GEMINI_MODEL,
    messages,
    response_format: MEDIA_RESPONSE_FORMAT,
  });
  trackLlmCall(costEntry);

  const content = response.choices?.[0]?.message?.content ?? "";
  return {
    type: "image",
    url: imageUrl,
    description: parseMediaResponse(content),
  };
}

// --- Video analysis ---

async function downloadVideo(videoUrl: string, tmpDir: string): Promise<string> {
  const videoPath = join(tmpDir, "video.mp4");
  const response = await fetch(videoUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
  await writeFile(videoPath, Buffer.from(await response.arrayBuffer()));
  return videoPath;
}

async function extractAudio(videoPath: string, tmpDir: string): Promise<string> {
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

async function analyzeShortVideo(videoPath: string, costName: string): Promise<GeminiMediaDescription> {
  const videoBytes = await readFile(videoPath);
  const b64 = videoBytes.toString("base64");
  const dataUrl = `data:video/mp4;base64,${b64}`;

  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: VIDEO_PROMPT },
        { type: "video_url" as const, video_url: { url: dataUrl } } as any,
      ],
    },
  ];

  const { response, costEntry } = await trackedLlmCreate(costName, {
    model: GEMINI_MODEL,
    messages,
    response_format: MEDIA_RESPONSE_FORMAT,
  });
  trackLlmCall(costEntry);

  return parseMediaResponse(response.choices?.[0]?.message?.content ?? "");
}

async function analyzeLongVideoFrames(videoPath: string, tmpDir: string, costName: string): Promise<GeminiMediaDescription> {
  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "fps=1/5,scale=640:-1" -frames:v 4 "${tmpDir}/frame%03d.jpg" -y 2>&1`,
    { timeout: 60000 },
  ).catch((err) => {
    console.error("[mediaAnalysisGemini] FFmpeg frame extraction error:", err.message);
  });

  const frameDataUrls: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const framePath = join(tmpDir, `frame${String(i).padStart(3, "0")}.jpg`);
    try {
      const frameStat = await stat(framePath);
      if (frameStat.size > 0) {
        const frameData = await readFile(framePath);
        frameDataUrls.push(`data:image/jpeg;base64,${frameData.toString("base64")}`);
      }
    } catch {
      break;
    }
  }

  if (frameDataUrls.length === 0) return { description: "", ocrText: "" };

  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: FRAME_PROMPT },
        ...frameDataUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ],
    },
  ];

  const { response, costEntry } = await trackedLlmCreate(costName, {
    model: GEMINI_MODEL,
    messages,
    response_format: MEDIA_RESPONSE_FORMAT,
  });
  trackLlmCall(costEntry);

  return parseMediaResponse(response.choices?.[0]?.message?.content ?? "");
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
        description = await analyzeLongVideoFrames(videoPath, tmpDir, costName);
      }
    } else {
      description = await analyzeShortVideo(videoPath, costName);
    }

    let transcription: string | undefined;
    if (!(await checkFfmpeg())) {
      transcription = "(ffmpeg unavailable)";
    } else {
      try {
        const text = await extractAudio(videoPath, tmpDir);
        if (text) {
          transcription = text;
        } else {
          transcription = "(no audio track)";
        }
      } catch (err: any) {
        console.error("[mediaAnalysisGemini] Audio extraction failed:", err.message);
        transcription = `(transcription failed: ${err.message?.slice(0, 100)})`;
      }
    }

    return { type: "video", url: videoUrl, description, transcription };
  } catch (err: any) {
    console.error("[mediaAnalysisGemini] Video analysis failed:", err.message);
    return { type: "video", url: videoUrl, description: { description: "", ocrText: "" }, };
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// --- Main entry point ---

async function analyzeMediaItems(
  mediaItems: any[],
  namePrefix: string,
  strategy: "full_video" | "frames" = "frames",
): Promise<GeminiMediaItem[]> {
  if (!mediaItems?.length) return [];

  const results: GeminiMediaItem[] = [];

  const images = mediaItems.filter((m) => m.type === "photo");
  const videos = mediaItems.filter((m) => m.type === "video" || m.type === "animated_gif");

  let imageIdx = 0;
  const imageResults = await Promise.all(
    images
      .map((img) => getBestUrl(img))
      .filter((url): url is string => !!url)
      .map((url) => describeImageFromUrl(url, `${namePrefix}.image.${imageIdx++}`).catch((err) => {
        console.error("[mediaAnalysisGemini] Image analysis failed:", err.message);
        return { type: "image" as const, url, description: { description: "", ocrText: "" } };
      })),
  );
  results.push(...imageResults);

  let videoIdx = 0;
  for (const video of videos) {
    const videoUrl = getBestUrl(video);
    if (!videoUrl) continue;
    results.push(await analyzeVideo(videoUrl, video.duration_ms, `${namePrefix}.video.${videoIdx++}`, strategy));
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
  const dataUrl = `data:${imageMimeFromPath(filePath)};base64,${bytes.toString("base64")}`;
  return describeImageFromUrl(dataUrl, costName);
}

/**
 * Download a media URL (YouTube/Vimeo/TikTok/Twitch/Instagram/Facebook/etc.)
 * with yt-dlp, then run the resulting file through the appropriate Gemini
 * pipeline — video analysis for video files, image analysis for image files
 * (e.g. Instagram photo posts). Caller catches errors (yt-dlp failure, removed
 * content, URL not actually media) and decides how to surface them.
 */
export async function describeMediaFromUrl(
  url: string,
  costName: string,
  strategy: "full_video" | "frames" = "frames",
): Promise<MediaSourceDescription> {
  const tmpDir = join(tmpdir(), `cn-media-source-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
  try {
    const { meta, filePath, kind } = downloadWithYtDlp(url, tmpDir);
    if (!filePath || !kind) throw new Error(`yt-dlp produced no usable media file for ${url}`);
    if (kind === "video") {
      const durationMs = meta.duration ? Math.round(meta.duration * 1000) : undefined;
      const analysis = await analyzeVideo(filePath, durationMs, costName, strategy);
      return { kind, meta, analysis };
    }
    const analysis = await describeImageFromLocalFile(filePath, costName);
    return { kind, meta, analysis };
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

export async function analyzeMediaGemini(
  tweetMedia?: any[],
  quotedTweetMedia?: any[],
  strategy: "full_video" | "frames" = "frames",
): Promise<GeminiMediaResult> {
  const startMs = Date.now();
  const log = getTweetLog();

  const [tweetResults, quotedResults] = await Promise.all([
    analyzeMediaItems(tweetMedia ?? [], "media.tweet", strategy),
    analyzeMediaItems(quotedTweetMedia ?? [], "media.quoted", strategy),
  ]);

  log?.set("media.gemini.tweetMedia", tweetResults);
  log?.set("media.gemini.quotedTweetMedia", quotedResults);
  log?.set("media.gemini.durationMs", Date.now() - startMs);

  return {
    tweetMedia: tweetResults,
    quotedTweetMedia: quotedResults,
  };
}
