/**
 * Audio Transcription
 *
 * Extracts audio from video via FFmpeg, then transcribes using
 * Groq Whisper (preferred) or OpenRouter GPT-4o-audio (fallback).
 */

import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { readFile, writeFile, rm, mkdir, stat } from "fs/promises";

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

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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
 * Extract audio from a video and transcribe it.
 * Returns empty string if FFmpeg unavailable or no audio track.
 */
export async function transcribeVideoAudio(videoUrl: string): Promise<string> {
  if (!(await checkFfmpeg())) {
    console.warn("[audioTranscription] FFmpeg not available, skipping transcription");
    return "";
  }

  const isLocalFile = videoUrl.startsWith("/");
  if (!isLocalFile && !validateUrl(videoUrl)) return "";

  const groqApiKey = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!groqApiKey && !openRouterKey) return "";

  const tmpDir = join(tmpdir(), `cn-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await mkdir(tmpDir, { recursive: true });

    let videoPath: string;
    if (isLocalFile) {
      videoPath = videoUrl;
    } else {
      videoPath = join(tmpDir, "video.mp4");
      const response = await fetch(videoUrl, { redirect: "follow" });
      if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
      await writeFile(videoPath, Buffer.from(await response.arrayBuffer()));
    }

    const audioPath = join(tmpDir, "audio.mp3");
    await execAsync(
      `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 "${audioPath}" -y 2>&1`,
      { timeout: 60000 }
    );

    const audioStat = await stat(audioPath);
    if (audioStat.size < 1000) return "";

    const audioBuffer = await readFile(audioPath);

    if (groqApiKey) {
      try {
        const result = await transcribeWithGroq(audioBuffer);
        if (result) return result;
      } catch (err: any) {
        console.error("[audioTranscription] Groq failed:", err.message);
      }
    }

    if (openRouterKey) {
      try {
        return await transcribeWithOpenRouter(audioBuffer);
      } catch (err: any) {
        console.error("[audioTranscription] OpenRouter failed:", err.message);
      }
    }

    return "";
  } catch (err: any) {
    console.error("[audioTranscription] Failed:", err.message);
    return "";
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}
