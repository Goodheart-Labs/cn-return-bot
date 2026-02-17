/**
 * Media Analysis
 *
 * Extracts meaningful content from media in tweets:
 * - Videos: Extract key frames, transcribe audio
 * - Images: Describe with vision model, extract text
 */

import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { readFile, writeFile, rm, mkdir, stat } from "fs/promises";
import { llm } from "./llm";

const execAsync = promisify(exec);

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

export interface VideoAnalysisResult {
  url: string;
  transcription?: string;
  keyFrameDescriptions: string[];
  durationMs?: number;
  hasAudio: boolean;
  error?: string;
}

export interface ImageAnalysisResult {
  url: string;
  description: string;
  textContent?: string;
  error?: string;
}

export interface MediaAnalysisResult {
  summary: string;
  videos: VideoAnalysisResult[];
  images: ImageAnalysisResult[];
  contextForSearch: string;
  totalAnalysisTimeMs: number;
}

/**
 * Validate URL to prevent command injection
 */
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow http/https protocols
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Transcribe audio using Groq Whisper API (preferred, fast & free)
 */
async function transcribeWithGroq(audioBuffer: Buffer): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) return "";

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/mp3" }), "audio.mp3");
  formData.append("model", "whisper-large-v3");
  formData.append("response_format", "text");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} ${errorText}`);
  }

  return (await response.text()).trim();
}

/**
 * Transcribe audio using OpenRouter's audio-capable models (fallback)
 * Uses GPT-4o-audio or similar model that supports input_audio
 */
async function transcribeWithOpenRouter(audioBuffer: Buffer): Promise<string> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) return "";

  const base64Audio = audioBuffer.toString("base64");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-audio-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this audio exactly as spoken. Output ONLY the transcription, nothing else.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format: "mp3",
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter audio API error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  return (result.choices?.[0]?.message?.content || "").trim();
}

/**
 * Describe an image using vision model
 */
export async function describeImage(
  imageUrl: string,
  model: string = "anthropic/claude-sonnet-4"
): Promise<ImageAnalysisResult> {
  console.log(`[mediaAnalysis] Describing image...`);

  try {
    const result = await llm.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Describe this image in detail for fact-checking purposes. Include:
1. What the image shows (people, objects, text, setting)
2. Any visible text, numbers, or captions
3. Any claims or assertions the image appears to make
4. Context clues (location, time period, event type)
5. Anything that could be verified or fact-checked

Be specific and factual. If you see text, quote it exactly.`,
            },
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
    });

    const description = result.choices?.[0]?.message?.content || "";

    return {
      url: imageUrl,
      description,
    };
  } catch (err: any) {
    console.error("[mediaAnalysis] Image description failed:", err.message);
    return {
      url: imageUrl,
      description: "",
      error: err.message,
    };
  }
}

/**
 * Describe video frames using vision model
 */
async function describeVideoFrames(
  frames: Buffer[],
  model: string = "anthropic/claude-sonnet-4"
): Promise<string[]> {
  if (frames.length === 0) return [];

  console.log(`[mediaAnalysis] Describing ${frames.length} video frames...`);

  // Convert frames to base64 data URLs
  const frameDataUrls = frames.map(
    (frame) => `data:image/jpeg;base64,${frame.toString("base64")}`
  );

  // Describe all frames in one call for efficiency
  try {
    const result = await llm.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `These are ${frames.length} frames extracted from a video, for fact-checking purposes.

For each frame, briefly describe:
- What's happening
- Any visible text or graphics
- Key people or objects
- Any claims being made

Format as:
Frame 1: [description]
Frame 2: [description]
...`,
            },
            ...frameDataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
    });

    const content = result.choices?.[0]?.message?.content || "";

    // Parse frame descriptions
    const descriptions: string[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const match = line.match(/^Frame \d+:\s*(.+)/i);
      if (match && match[1]) {
        descriptions.push(match[1].trim());
      }
    }

    // If parsing failed, return the whole content as one description
    if (descriptions.length === 0 && content) {
      descriptions.push(content);
    }

    return descriptions;
  } catch (err: any) {
    console.error("[mediaAnalysis] Frame description failed:", err.message);
    return [];
  }
}

/**
 * Analyze a single video
 *
 * Downloads the video once and reuses the local file for both
 * frame extraction and audio transcription.
 */
async function analyzeVideo(
  videoUrl: string,
  config: {
    maxFrames?: number;
    transcribeAudio?: boolean;
    visionModel?: string;
  }
): Promise<VideoAnalysisResult> {
  const maxFrames = config.maxFrames ?? 4;
  const shouldTranscribe = config.transcribeAudio ?? true;
  const visionModel = config.visionModel || "anthropic/claude-sonnet-4";

  console.log(`[mediaAnalysis] Analyzing video: ${videoUrl.substring(0, 50)}...`);

  if (!validateUrl(videoUrl)) {
    console.error("[mediaAnalysis] Invalid video URL:", videoUrl);
    return { url: videoUrl, keyFrameDescriptions: [], hasAudio: false, error: "Invalid URL" };
  }

  const tmpDir = join(tmpdir(), `cn-video-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await mkdir(tmpDir, { recursive: true });

    // Download video once
    const videoPath = join(tmpDir, "video.mp4");
    const response = await fetch(videoUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }
    await writeFile(videoPath, Buffer.from(await response.arrayBuffer()));

    // Extract frames from local file
    const frames: Buffer[] = [];
    await execAsync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/5,scale=640:-1" -frames:v ${maxFrames} "${tmpDir}/frame%03d.jpg" -y 2>&1`,
      { timeout: 60000 }
    ).catch((err) => {
      console.error("[mediaAnalysis] FFmpeg frame extraction error:", err.message);
    });

    for (let i = 1; i <= maxFrames; i++) {
      const framePath = join(tmpDir, `frame${String(i).padStart(3, "0")}.jpg`);
      try {
        const frameStat = await stat(framePath);
        if (frameStat.size > 0) {
          frames.push(await readFile(framePath));
        }
      } catch {
        break;
      }
    }
    console.log(`[mediaAnalysis] Extracted ${frames.length} frames from video`);

    // Describe frames
    const frameDescriptions = await describeVideoFrames(frames, visionModel);

    // Extract audio and transcribe from local file
    let transcription = "";
    if (shouldTranscribe) {
      const groqApiKey = process.env.GROQ_API_KEY;
      const openRouterKey = process.env.OPENROUTER_API_KEY;

      if (groqApiKey || openRouterKey) {
        try {
          const audioPath = join(tmpDir, "audio.mp3");
          await execAsync(
            `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 "${audioPath}" -y 2>&1`,
            { timeout: 60000 }
          );

          const audioStat = await stat(audioPath);
          if (audioStat.size >= 1000) {
            const audioBuffer = await readFile(audioPath);

            if (groqApiKey) {
              try {
                console.log("[mediaAnalysis] Transcribing with Groq Whisper...");
                transcription = await transcribeWithGroq(audioBuffer);
                console.log(`[mediaAnalysis] Groq transcribed ${transcription.length} characters`);
              } catch (err: any) {
                console.error("[mediaAnalysis] Groq transcription failed:", err.message);
              }
            }

            if (!transcription && openRouterKey) {
              try {
                console.log("[mediaAnalysis] Falling back to OpenRouter audio transcription...");
                transcription = await transcribeWithOpenRouter(audioBuffer);
                console.log(`[mediaAnalysis] OpenRouter transcribed ${transcription.length} characters`);
              } catch (err: any) {
                console.error("[mediaAnalysis] OpenRouter transcription failed:", err.message);
              }
            }
          } else {
            console.log("[mediaAnalysis] Audio file too small, video may have no audio");
          }
        } catch (err: any) {
          console.error("[mediaAnalysis] Audio extraction failed:", err.message);
        }
      } else {
        console.log("[mediaAnalysis] No transcription API key set, skipping transcription");
      }
    }

    return {
      url: videoUrl,
      transcription: transcription || undefined,
      keyFrameDescriptions: frameDescriptions,
      hasAudio: transcription.length > 0,
    };
  } catch (err: any) {
    console.error("[mediaAnalysis] Video analysis failed:", err.message);
    return {
      url: videoUrl,
      keyFrameDescriptions: [],
      hasAudio: false,
      error: err.message,
    };
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Get the best downloadable URL for a media item.
 * For photos, use the url field. For videos, pick the highest-bitrate mp4 variant.
 */
function getBestUrl(item: {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: Array<{ bit_rate?: number; content_type: string; url: string }>;
}): string | undefined {
  if (item.type === "photo") {
    return item.url || item.preview_image_url;
  }

  // For video/animated_gif, try to get the best mp4 variant
  if (item.variants?.length) {
    const mp4Variants = item.variants
      .filter((v) => v.content_type === "video/mp4")
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));
    if (mp4Variants[0]) {
      return mp4Variants[0].url;
    }
    // Fallback to any variant with a URL
    return item.variants[0]?.url;
  }

  // Last resort: direct url or preview
  return item.url || item.preview_image_url;
}

/**
 * Full media analysis pipeline
 */
export async function analyzeMedia(
  media: Array<{
    type: string;
    url?: string;
    preview_image_url?: string;
    variants?: Array<{ bit_rate?: number; content_type: string; url: string }>;
  }>,
  config?: {
    maxVideoFrames?: number;
    transcribeAudio?: boolean;
    visionModel?: string;
  }
): Promise<MediaAnalysisResult> {
  const startTime = Date.now();
  const maxVideoFrames = config?.maxVideoFrames ?? 4;
  const transcribeAudio = config?.transcribeAudio ?? true;
  const visionModel = config?.visionModel || "anthropic/claude-sonnet-4";

  console.log(`[mediaAnalysis] Analyzing ${media.length} media items...`);

  const videos: VideoAnalysisResult[] = [];
  const images: ImageAnalysisResult[] = [];

  // Separate videos and images
  const videoItems = media.filter((m) => m.type === "video" || m.type === "animated_gif");
  const imageItems = media.filter((m) => m.type === "photo");

  // Analyze videos (sequentially to avoid overwhelming FFmpeg)
  if (videoItems.length > 0 && !(await checkFfmpeg())) {
    console.log("[mediaAnalysis] FFmpeg not available, skipping video analysis");
  }
  for (const video of ffmpegAvailable ? videoItems : []) {
    const videoUrl = getBestUrl(video);
    if (!videoUrl) {
      console.log("[mediaAnalysis] Skipping video: no downloadable URL found");
      continue;
    }
    const result = await analyzeVideo(videoUrl, {
      maxFrames: maxVideoFrames,
      transcribeAudio,
      visionModel,
    });
    videos.push(result);
  }

  // Analyze images (in parallel)
  const imagePromises = imageItems
    .map((img) => getBestUrl(img))
    .filter((url): url is string => !!url)
    .map((url) => describeImage(url, visionModel));
  const imageResults = await Promise.all(imagePromises);
  images.push(...imageResults);

  // Build summary
  const summaryParts: string[] = [];

  for (const video of videos) {
    if (video.transcription) {
      summaryParts.push(`VIDEO AUDIO TRANSCRIPT:\n${video.transcription}`);
    }
    if (video.keyFrameDescriptions.length > 0) {
      summaryParts.push(`VIDEO VISUAL CONTENT:\n${video.keyFrameDescriptions.join("\n")}`);
    }
  }

  for (const image of images) {
    if (image.description) {
      summaryParts.push(`IMAGE CONTENT:\n${image.description}`);
    }
  }

  const summary = summaryParts.join("\n\n---\n\n");

  // Format context for search
  const contextForSearch = summary
    ? `\n\n=== MEDIA ANALYSIS ===\n${summary}`
    : "";

  const totalTime = Date.now() - startTime;
  console.log(`[mediaAnalysis] Complete in ${totalTime}ms. Videos: ${videos.length}, Images: ${images.length}`);

  return {
    summary,
    videos,
    images,
    contextForSearch,
    totalAnalysisTimeMs: totalTime,
  };
}
