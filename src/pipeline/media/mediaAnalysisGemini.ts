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
import { llm } from "../llm/llm";
import { getTweetLog } from "../utils/tweetLog";

const execAsync = promisify(exec);

const GEMINI_MODEL = "google/gemini-3-flash-preview";
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

const IMAGE_PROMPT = `Analyze this image and return JSON:
{"description": "A description of what the image shows", "ocr_text": "All visible text in the image, quoted exactly. Empty string if no text."}`;

const VIDEO_PROMPT = `Analyze this video and return JSON:
{"description": "A description of what happens in the video", "ocr_text": "All visible text in the video, quoted exactly. Empty string if no text."}`;

const FRAME_PROMPT = `These are frames extracted from a video. Return JSON:
{"description": "A description of what happens in the video", "ocr_text": "All visible text across the frames, quoted exactly. Empty string if no text."}`;

// --- Helpers ---

function parseJsonResponse(content: string): GeminiMediaDescription {
  // Strip markdown code fences if present
  const cleaned = content.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      description: String(parsed.description ?? ""),
      ocrText: String(parsed.ocr_text ?? ""),
    };
  } catch {
    return { description: content, ocrText: "" };
  }
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

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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

async function analyzeImage(imageUrl: string): Promise<GeminiMediaItem> {
  const messages = [
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: IMAGE_PROMPT },
        { type: "image_url" as const, image_url: { url: imageUrl } },
      ],
    },
  ];

  const result = await llm.create({
    model: GEMINI_MODEL,
    messages,
    response_format: { type: "json_object" as const },
  });

  const content = result.choices?.[0]?.message?.content ?? "";
  return {
    type: "image",
    url: imageUrl,
    description: parseJsonResponse(content),
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

async function analyzeShortVideo(videoPath: string): Promise<GeminiMediaDescription> {
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

  const result = await llm.create({
    model: GEMINI_MODEL,
    messages,
    response_format: { type: "json_object" as const },
  });

  return parseJsonResponse(result.choices?.[0]?.message?.content ?? "");
}

async function analyzeLongVideoFrames(videoPath: string, tmpDir: string): Promise<GeminiMediaDescription> {
  // Extract 4 uniformly sampled frames
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

  const result = await llm.create({
    model: GEMINI_MODEL,
    messages,
    response_format: { type: "json_object" as const },
  });

  return parseJsonResponse(result.choices?.[0]?.message?.content ?? "");
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

async function analyzeVideo(
  videoUrl: string,
  durationMs?: number,
): Promise<GeminiMediaItem> {
  if (!validateUrl(videoUrl)) {
    return { type: "video", url: videoUrl, description: { description: "", ocrText: "" } };
  }

  const tmpDir = join(tmpdir(), `cn-gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await mkdir(tmpDir, { recursive: true });
    const videoPath = await downloadVideo(videoUrl, tmpDir);

    const isLong = durationMs != null && durationMs > LONG_VIDEO_THRESHOLD_MS;

    // Vision analysis
    let description: GeminiMediaDescription;
    if (isLong) {
      if (!(await checkFfmpeg())) {
        console.warn("[mediaAnalysisGemini] FFmpeg not available, skipping long video frames");
        description = { description: "", ocrText: "" };
      } else {
        description = await analyzeLongVideoFrames(videoPath, tmpDir);
      }
    } else {
      description = await analyzeShortVideo(videoPath);
    }

    // Audio transcription
    let transcription: string | undefined;
    if (await checkFfmpeg()) {
      try {
        const text = await extractAudio(videoPath, tmpDir);
        if (text) transcription = text;
      } catch (err: any) {
        console.error("[mediaAnalysisGemini] Audio extraction failed:", err.message);
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
): Promise<GeminiMediaItem[]> {
  if (!mediaItems?.length) return [];

  const results: GeminiMediaItem[] = [];

  const images = mediaItems.filter((m) => m.type === "photo");
  const videos = mediaItems.filter((m) => m.type === "video" || m.type === "animated_gif");

  // Images in parallel
  const imageResults = await Promise.all(
    images
      .map((img) => getBestUrl(img))
      .filter((url): url is string => !!url)
      .map((url) => analyzeImage(url).catch((err) => {
        console.error("[mediaAnalysisGemini] Image analysis failed:", err.message);
        return { type: "image" as const, url, description: { description: "", ocrText: "" } };
      })),
  );
  results.push(...imageResults);

  // Videos sequentially (ffmpeg is CPU-intensive)
  for (const video of videos) {
    const videoUrl = getBestUrl(video);
    if (!videoUrl) continue;
    results.push(await analyzeVideo(videoUrl, video.duration_ms));
  }

  return results;
}

export async function analyzeMediaGemini(
  tweetMedia?: any[],
  quotedTweetMedia?: any[],
): Promise<GeminiMediaResult> {
  const startMs = Date.now();
  const log = getTweetLog();

  const [tweetResults, quotedResults] = await Promise.all([
    analyzeMediaItems(tweetMedia ?? []),
    analyzeMediaItems(quotedTweetMedia ?? []),
  ]);

  log?.set("media.gemini.tweetMedia", tweetResults);
  log?.set("media.gemini.quotedTweetMedia", quotedResults);
  log?.set("media.gemini.durationMs", Date.now() - startMs);

  return {
    tweetMedia: tweetResults,
    quotedTweetMedia: quotedResults,
  };
}
