/**
 * Media Analysis
 *
 * Orchestrates media analysis for tweets:
 * - Videos: Gemini visual description + OCR, FFmpeg audio transcription
 * - Images: Vision model description
 */

import { describeVideo, type VideoDescriptionResult } from "./videoDescription";
import { transcribeVideoAudio } from "./audioTranscription";
import { describeImage, type ImageAnalysisResult } from "./imageDescription";
import { getTweetLog } from "../tweetLog";

export type { ImageAnalysisResult };

export interface VideoAnalysisResult {
  url: string;
  description: string;
  textContent?: string;
  transcription?: string;
  hasAudio: boolean;
  error?: string;
}

export interface MediaAnalysisResult {
  summary: string;
  videos: VideoAnalysisResult[];
  images: ImageAnalysisResult[];
  contextForSearch: string;
  totalAnalysisTimeMs: number;
  warnings: string[];
}

function getBestUrl(item: {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: Array<{ bit_rate?: number; content_type: string; url: string }>;
}): string | undefined {
  if (item.type === "photo") {
    return item.url || item.preview_image_url;
  }

  if (item.variants?.length) {
    const mp4Variants = item.variants
      .filter((v) => v.content_type === "video/mp4")
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));
    if (mp4Variants[0]) {
      return mp4Variants[0].url;
    }
    return item.variants[0]?.url;
  }

  return item.url || item.preview_image_url;
}

async function analyzeVideo(
  videoUrl: string,
  visionModel: string
): Promise<VideoAnalysisResult> {
  // Run visual description and audio transcription in parallel
  const [descResult, transcription] = await Promise.all([
    describeVideo(videoUrl, visionModel),
    transcribeVideoAudio(videoUrl),
  ]);

  return {
    url: videoUrl,
    description: descResult.description,
    textContent: descResult.textContent,
    transcription: transcription || undefined,
    hasAudio: transcription.length > 0,
    error: descResult.error,
  };
}

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
  const visionModel = config?.visionModel || "google/gemini-3-flash-preview";

  const videos: VideoAnalysisResult[] = [];
  const images: ImageAnalysisResult[] = [];
  const warnings: string[] = [];

  const videoItems = media.filter((m) => m.type === "video" || m.type === "animated_gif");
  const imageItems = media.filter((m) => m.type === "photo");

  // Analyze videos sequentially (large uploads)
  for (const video of videoItems) {
    const videoUrl = getBestUrl(video);
    if (!videoUrl) continue;
    const result = await analyzeVideo(videoUrl, visionModel);
    if (result.error) {
      warnings.push(`Video analysis failed: ${result.error}`);
    }
    videos.push(result);
  }

  // Analyze images in parallel
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
    if (video.transcription) {
      summaryParts.push(`VIDEO AUDIO TRANSCRIPT:\n${video.transcription}`);
    }
    if (video.description) {
      summaryParts.push(`VIDEO VISUAL CONTENT:\n${video.description}`);
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

  const contextForSearch = summary
    ? `\n\n=== MEDIA ANALYSIS ===\n${summary}`
    : "";

  const totalTime = Date.now() - startTime;

  // Write to tweet log
  const log = getTweetLog();
  log?.set("media.videos", videos.map((v) => ({
    url: v.url,
    description: v.description,
    textContent: v.textContent,
    transcription: v.transcription,
    hasAudio: v.hasAudio,
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
