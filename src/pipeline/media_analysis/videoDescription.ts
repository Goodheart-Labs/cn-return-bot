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

const GEMINI_VIDEO_MODEL = "google/gemini-3-flash-preview";

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

function parseResponse(content: string): {
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
 * Analyze a video's visual content and extract on-screen text.
 * Sends the full video to Gemini — no frame extraction needed.
 */
export async function describeVideo(
  videoUrl: string,
  model: string = GEMINI_VIDEO_MODEL
): Promise<VideoDescriptionResult> {
  const isLocalFile = videoUrl.startsWith("/");

  if (!isLocalFile && !validateUrl(videoUrl)) {
    console.error("[videoDescription] Invalid video URL:", videoUrl);
    return { description: "", error: "Invalid URL" };
  }

  try {
    const base64Video = await downloadVideoAsBase64(videoUrl);

    const result = await llm.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this video for fact-checking purposes. Provide two sections:

DESCRIPTION:
Describe the visual content of the video in detail. Include:
- What's happening in each scene
- Any visible text or graphics
- Key people or objects
- Any claims being made visually
- Context clues (location, time period, event type)

Be specific and factual.

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
    const { description, textContent } = parseResponse(content);

    return {
      description,
      textContent: textContent || undefined,
    };
  } catch (err: any) {
    console.error("[videoDescription] Video analysis failed:", err.message);
    return {
      description: "",
      error: err.message,
    };
  }
}
