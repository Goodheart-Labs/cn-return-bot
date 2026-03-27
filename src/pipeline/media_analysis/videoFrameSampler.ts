/**
 * Video Frame Sampler
 *
 * Fallback for long videos (>3.5 min) that are too large to send whole to Gemini.
 * Extracts evenly-spaced frames via FFmpeg and analyzes them as images.
 * Audio transcription happens separately — this covers the visual signal.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { readFile, writeFile, rm, mkdir, stat } from "fs/promises";
import { llm } from "../llm";
import type { VideoDescriptionResult } from "./videoDescription";

const execAsync = promisify(exec);

const MAX_FRAMES = 4;
const FRAME_WIDTH_PX = 640;

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function resolveVideoPath(url: string, workDir: string): Promise<string> {
  if (url.startsWith("/")) return url;

  const out = join(workDir, "video.mp4");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

async function extractFrames(videoPath: string, durationSec: number, workDir: string): Promise<Buffer[]> {
  const interval = Math.round(durationSec / (MAX_FRAMES + 1));
  await execAsync(
    `ffmpeg -i "${videoPath}" -vf "fps=1/${interval},scale=${FRAME_WIDTH_PX}:-1" -frames:v ${MAX_FRAMES} "${workDir}/frame%03d.jpg" -y 2>&1`,
    { timeout: 60_000 },
  );

  const frames: Buffer[] = [];
  for (let i = 1; i <= MAX_FRAMES; i++) {
    const framePath = join(workDir, `frame${String(i).padStart(3, "0")}.jpg`);
    try {
      if ((await stat(framePath)).size > 0) frames.push(await readFile(framePath));
    } catch {
      break;
    }
  }
  return frames;
}

// ── Public API ───────────────────────────────────────────────────────────

export async function describeVideoByFrames(
  videoUrl: string,
  durationSec: number,
  model: string,
): Promise<VideoDescriptionResult> {
  const workDir = join(tmpdir(), `cn-frames-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await mkdir(workDir, { recursive: true });
    const videoPath = await resolveVideoPath(videoUrl, workDir);
    const frames = await extractFrames(videoPath, durationSec, workDir);

    if (frames.length === 0) return { description: "", error: "No frames extracted" };

    console.log(`[videoFrameSampler] ${frames.length} frames from ${formatDuration(durationSec)} video`);

    const result = await llm.create({
      model,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `These are ${frames.length} evenly-spaced frames from a ${formatDuration(durationSec)} video, for fact-checking.

Respond as JSON:
- "text_content": ALL on-screen text across all frames (subtitles, chyrons, signs, watermarks). Quote exactly. "No text detected." if none.
- "description": For each frame, describe what's happening, visible text/graphics, key people/objects, and any claims being made. Label as Frame 1, Frame 2, etc.`,
          },
          ...frames.map((f) => ({
            type: "image_url" as const,
            image_url: { url: `data:image/jpeg;base64,${f.toString("base64")}` },
          })),
        ],
      }],
      response_format: { type: "json_object" },
    });

    const raw = (result.choices?.[0]?.message?.content || "") as string;
    const parsed = JSON.parse(raw);
    const prefix = `${formatDuration(durationSec)} video, ${frames.length} frames uniformly sampled:\n`;
    return { description: prefix + (parsed.description || ""), textContent: parsed.text_content || undefined };
  } catch (err: any) {
    console.error("[videoFrameSampler] Failed:", err.message);
    return { description: "", error: err.message };
  } finally {
    try { await rm(workDir, { recursive: true, force: true }); } catch {}
  }
}
