/**
 * Media Analysis
 *
 * Extracts meaningful content from media in tweets:
 * - Videos: Send full video to Gemini for description + OCR
 * - Images: Describe with vision model, extract text
 */

import { tmpdir } from "os";
import { join } from "path";
import { readFile, writeFile, rm, mkdir } from "fs/promises";
import { llm } from "./llm";
import { getTweetLog } from "./tweetLog";

const GEMINI_VIDEO_MODEL = "google/gemini-2.5-flash";

export interface VideoAnalysisResult {
  url: string;
  description: string;
  textContent?: string;
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
  /** Non-fatal issues encountered during analysis */
  warnings: string[];
}

/**
 * Validate URL to prevent command injection
 */
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Download a video and return its base64-encoded data URL
 */
async function downloadVideoAsBase64(videoUrl: string): Promise<string> {
  const isLocalFile = videoUrl.startsWith("/");

  if (isLocalFile) {
    const buffer = await readFile(videoUrl);
    return `data:video/mp4;base64,${buffer.toString("base64")}`;
  }

  const tmpDir = join(tmpdir(), `cn-video-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await mkdir(tmpDir, { recursive: true });
    const videoPath = join(tmpDir, "video.mp4");
    const response = await fetch(videoUrl, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(videoPath, buffer);
    return `data:video/mp4;base64,${buffer.toString("base64")}`;
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Analyze a single video by sending it to Gemini for description + OCR
 */
async function analyzeVideo(videoUrl: string): Promise<VideoAnalysisResult> {
  const isLocalFile = videoUrl.startsWith("/");

  if (!isLocalFile && !validateUrl(videoUrl)) {
    console.error("[mediaAnalysis] Invalid video URL:", videoUrl);
    return { url: videoUrl, description: "", error: "Invalid URL" };
  }

  try {
    const base64Video = await downloadVideoAsBase64(videoUrl);

    const result = await llm.create({
      model: GEMINI_VIDEO_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this video for fact-checking purposes. Provide two sections:

DESCRIPTION:
Describe what happens in the video in detail. Include:
- What the video shows (people, objects, events, settings)
- Key claims or assertions being made (spoken or visual)
- Context clues (location, time period, event type)
- Audio content: summarize or transcribe what is said

TEXT CONTENT (OCR):
List ALL text visible in the video, including:
- Subtitles or captions
- On-screen text, titles, chyrons
- Signs, labels, watermarks
- Any other readable text

Quote all text exactly as it appears. If no text is visible, write "No text detected."`,
            },
            {
              type: "video_url" as any,
              video_url: { url: base64Video },
            },
          ],
        },
      ],
    });

    const content = (result.choices?.[0]?.message?.content || "") as string;

    const { description, textContent } = parseVideoAnalysisResponse(content);

    return {
      url: videoUrl,
      description,
      textContent: textContent || undefined,
    };
  } catch (err: any) {
    console.error("[mediaAnalysis] Video analysis failed:", err.message);
    return {
      url: videoUrl,
      description: "",
      error: err.message,
    };
  }
}

/**
 * Parse the structured response from Gemini into description and text content sections
 */
function parseVideoAnalysisResponse(content: string): {
  description: string;
  textContent: string;
} {
  const descriptionMatch = content.match(
    /DESCRIPTION:\s*\n([\s\S]*?)(?=\n\s*TEXT CONTENT|$)/i
  );
  const textMatch = content.match(/TEXT CONTENT.*?:\s*\n([\s\S]*?)$/i);

  return {
    description: descriptionMatch?.[1]?.trim() || content.trim(),
    textContent: textMatch?.[1]?.trim() || "",
  };
}

/**
 * Describe an image using vision model
 */
async function describeImage(
  imageUrl: string,
  model: string = "anthropic/claude-sonnet-4"
): Promise<ImageAnalysisResult> {
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
      description: description as string,
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
    visionModel?: string;
  }
): Promise<MediaAnalysisResult> {
  const startTime = Date.now();
  const visionModel = config?.visionModel || "anthropic/claude-sonnet-4";

  const videos: VideoAnalysisResult[] = [];
  const images: ImageAnalysisResult[] = [];
  const warnings: string[] = [];

  // Separate videos and images
  const videoItems = media.filter((m) => m.type === "video" || m.type === "animated_gif");
  const imageItems = media.filter((m) => m.type === "photo");

  // Analyze videos (sequentially to avoid large concurrent uploads)
  for (const video of videoItems) {
    const videoUrl = getBestUrl(video);
    if (!videoUrl) continue;
    const result = await analyzeVideo(videoUrl);
    if (result.error) {
      warnings.push(`Video analysis failed: ${result.error}`);
    }
    videos.push(result);
  }

  // Analyze images (in parallel)
  const imagePromises = imageItems
    .map((img) => getBestUrl(img))
    .filter((url): url is string => !!url)
    .map((url) => describeImage(url, visionModel));
  const imageResults = await Promise.all(imagePromises);
  for (const img of imageResults) {
    if (img.error) {
      warnings.push(`Image analysis failed: ${img.error}`);
    }
  }
  images.push(...imageResults);

  // Build summary
  const summaryParts: string[] = [];

  for (const video of videos) {
    if (video.description) {
      summaryParts.push(`VIDEO DESCRIPTION:\n${video.description}`);
    }
    if (video.textContent) {
      summaryParts.push(`VIDEO TEXT CONTENT (OCR):\n${video.textContent}`);
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

  // Write media analysis results to tweet log
  const log = getTweetLog();
  log?.set("media.videos", videos.map((v) => ({
    url: v.url,
    description: v.description,
    textContent: v.textContent,
    error: v.error,
  })));
  log?.set("media.images", images.map((img) => ({
    url: img.url,
    description: img.description,
    textContent: img.textContent,
    error: img.error,
  })));
  log?.set("media.summary", summary);
  log?.set("media.timeMs", totalTime);
  if (warnings.length > 0) log?.set("media.warnings", warnings);

  return {
    summary,
    videos,
    images,
    contextForSearch,
    totalAnalysisTimeMs: totalTime,
    warnings,
  };
}
