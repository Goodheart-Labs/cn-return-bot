/**
 * Import the curated Dwarkesh Podcast clip-notes into the Common Notes tables,
 * under the "dwarkesh" project. Source: the note_clips_output run (vendored as
 * src/everything/dwarkesh_clips/*.json), one JSON per clip with the note text
 * (sources inline), the claim, the verbatim context, and the exact YouTube
 * [start, end] clip span.
 *
 * Replaces any existing Dwarkesh items on each run (idempotent).
 *
 *   bun run src/everything/importDwarkesh.ts [clips-dir]
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getSupabaseClient } from "../../api/supabaseClient";

const DEFAULT_CLIPS_DIR = path.join(import.meta.dir, "dwarkesh_clips");
const PROJECT_SLUG = "dwarkesh";
// Pad each clip so it starts a touch before, and ends a touch after, the exact span.
const CLIP_PAD_SECONDS = 1;

// Dwarkesh episode video id → guest (for the item title). The clip filenames
// carry the video id; this names the episodes we cover.
const EPISODE_TITLES: Record<string, string> = {
  Hrbq66XqtCo: "Jensen Huang",
  mDG_Hx3BSUE: "Dylan Patel",
  "Jj-kBHzUohs": "Phil Trammell",
  myP8UjAM1pk: "Michael Nielsen",
  U1FrhkLQnCI: "Ada Palmer",
};

interface ClipNote {
  note_text: string;
  claim: string;
  context: string;
  video_url: string;
  clip: { start_s: number; end_s: number; file: string };
}

/** Video id is the filename prefix up to the first "_" — but "Jj-kBHzUohs"
 *  contains no "_", so read it from the video_url instead (robust). */
function videoIdFromUrl(url: string): string {
  return url.match(/[?&]v=([\w-]{6,})/)?.[1] ?? "unknown";
}

async function projectId(): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .from("everything_projects")
    .select("id")
    .eq("slug", PROJECT_SLUG)
    .single();
  if (error || !data) throw new Error(`Project '${PROJECT_SLUG}' not found — run migration 050 first`);
  return data.id;
}

async function ensureEpisodeItem(project: string, videoId: string): Promise<string> {
  const db = getSupabaseClient();
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const title = EPISODE_TITLES[videoId] ?? videoId;
  const { data, error } = await db
    .from("everything_items")
    .upsert({ project_id: project, source: "podcast", url, title, status: "done" }, { onConflict: "url" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Upsert item ${url}: ${error?.message}`);
  return data.id;
}

async function main() {
  const clipsDir = process.argv[2] ?? DEFAULT_CLIPS_DIR;
  const files = fs.readdirSync(clipsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error(`No clip JSONs in ${clipsDir}`);

  const db = getSupabaseClient();
  const project = await projectId();

  // Clean slate: drop every existing Dwarkesh item (claims + notes cascade).
  const { data: existing } = await db.from("everything_items").select("id").eq("project_id", project);
  for (const row of existing ?? []) await db.from("everything_items").delete().eq("id", row.id);

  const itemIdByVideo = new Map<string, string>();
  let imported = 0;
  for (const file of files.sort()) {
    const clip: ClipNote = JSON.parse(fs.readFileSync(path.join(clipsDir, file), "utf8"));
    const videoId = videoIdFromUrl(clip.video_url);

    let itemId = itemIdByVideo.get(videoId);
    if (!itemId) {
      itemId = await ensureEpisodeItem(project, videoId);
      itemIdByVideo.set(videoId, itemId);
    }

    const startSeconds = Math.max(0, clip.clip.start_s - CLIP_PAD_SECONDS);
    const endSeconds = clip.clip.end_s + CLIP_PAD_SECONDS;
    const { data: claimRow, error: claimErr } = await db
      .from("everything_claims")
      .insert({
        item_id: itemId,
        claim: clip.claim,
        judgement: "uncertain",
        context_quote: clip.context,
        context_url: `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        status: "note",
      })
      .select("id")
      .single();
    if (claimErr || !claimRow) throw new Error(`Insert claim (${file}): ${claimErr?.message}`);

    const { error: noteErr } = await db
      .from("everything_notes")
      .insert({ claim_id: claimRow.id, note: clip.note_text });
    if (noteErr) throw new Error(`Insert note (${file}): ${noteErr.message}`);
    imported++;
  }
  console.log(`Imported ${imported} Dwarkesh clip-notes across ${itemIdByVideo.size} episodes`);
}

main().catch((err) => {
  console.error("[importDwarkesh] Fatal error:", err);
  process.exit(1);
});
