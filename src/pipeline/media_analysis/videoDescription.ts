/**
 * Video Description + OCR
 *
 * Sends the full video to Gemini for visual description and text extraction.
 * Focuses on visual content — audio transcription is handled separately.
 */

import { tmpdir } from "os";
import { join } from "path";
import { readFile, writeFile, rm, mkdir } from "fs/promises";
import { llm } from "../llm";

export interface VideoDescriptionResult {
  description: string;
  textContent?: string;
  error?: string;
}

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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

const VIDEO_ANALYSIS_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

/**
 * Analyze a video's visual content and extract on-screen text.
 * Sends the full video to Gemini — no frame extraction needed.
 */
export async function describeVideo(
  videoUrl: string,
  model: string
): Promise<VideoDescriptionResult> {
  const isLocalFile = videoUrl.startsWith("/");

  if (!isLocalFile && !validateUrl(videoUrl)) {
    console.error("[videoDescription] Invalid video URL:", videoUrl);
    return { description: "", error: "Invalid URL" };
  }

  try {
    const base64Video = await downloadVideoAsBase64(videoUrl);

    const result = await withTimeout(
      llm.create({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this video for fact-checking purposes.

Respond as JSON with two fields:
- "text_content": ALL text visible on screen (subtitles, captions, titles, chyrons, signs, labels, watermarks). Quote exactly as shown. If none, use "No text detected."
- "description": What happens visually — scenes, key people/objects, claims being made, context clues (location, time period, event type). Do NOT repeat text content here.`,
              },
              {
                type: "video_url",
                video_url: { url: base64Video },
              } as any,
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
      VIDEO_ANALYSIS_TIMEOUT_MS,
      "Video analysis timed out after 120s",
    );

    const content = (result.choices?.[0]?.message?.content || "") as string;
    const parsed = JSON.parse(content);

    return {
      description: parsed.description || "",
      textContent: parsed.text_content || undefined,
    };
  } catch (err: any) {
    console.error("[videoDescription] Video analysis failed:", err.message);
    return {
      description: "",
      error: err.message,
    };
  }
}
