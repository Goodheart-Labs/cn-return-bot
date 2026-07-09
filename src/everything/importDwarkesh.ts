/**
 * One-off import of the Dwarkesh Podcast fact-check runs bundled in
 * podcast_results.zip into the Common Notes tables, under the "dwarkesh" project.
 *
 * Each run's results.json holds every extracted claim; we import only the ones
 * that produced a note (needsCorrection) — 35 across 5 episodes — so the public
 * feed stays well under PostgREST's 1000-row cap. Re-running is idempotent
 * (each episode's claims are replaced).
 *
 *   bun run src/everything/importDwarkesh.ts [path/to/podcast_results.zip]
 */

import "dotenv/config";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { getSupabaseClient } from "../api/supabaseClient";

const DEFAULT_ZIP = path.resolve("podcast_results.zip");
const PROJECT_SLUG = "dwarkesh";

interface RunResult {
  claim: string;
  judgement: string;
  quote: string;
  needsCorrection: boolean;
  correction: string;
  sources: string[];
  videoLink?: string;
}

// dwarkeshTimestamps.json: guest → 1-based results index → { videoId, startSeconds }.
// Snapshotted from prod review_dashboard_items, where the (now-superseded)
// backfill matcher located each quote in the YouTube auto-captions and manual
// corrections were applied. The runs themselves were timestamp-less
// (--transcript-file), so this snapshot is the only timestamp source.
const TIMESTAMPS: Record<string, Record<string, { videoId: string; startSeconds: number }>> = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "dwarkeshTimestamps.json"), "utf8"),
);

// No end timestamps were ever stored, so estimate the clip end from the quote
// length at conversational pace, padded, and never shorter than a watchable clip.
const SPOKEN_WORDS_PER_SECOND = 2.4;
const CLIP_PAD_SECONDS = 4;
const MIN_CLIP_SECONDS = 12;

function estimateEndSeconds(startSeconds: number, quote: string): number {
  const spokenSeconds = quote.trim().split(/\s+/).length / SPOKEN_WORDS_PER_SECOND + CLIP_PAD_SECONDS;
  return startSeconds + Math.ceil(Math.max(MIN_CLIP_SECONDS, spokenSeconds));
}

function titleCase(slug: string): string {
  return slug.split(/[_-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** "youtube-claims-ada_palmer-2026-06-18-1814" → "ada_palmer". */
function guestFromDir(dir: string): string {
  return dir.replace(/^youtube-claims-/, "").replace(/-\d{4}-\d{2}-\d{2}-\d{4}$/, "");
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

async function importEpisode(dir: string, resultsPath: string, project: string): Promise<number> {
  const db = getSupabaseClient();
  const guest = guestFromDir(dir);
  const title = titleCase(guest);
  // The episode's video id (shared by all its claim timestamps) makes the item
  // link to the real episode; sentinel fallback if a run has no timestamps.
  const episodeVideoId = Object.values(TIMESTAMPS[guest] ?? {})[0]?.videoId;
  const url = episodeVideoId ? `https://www.youtube.com/watch?v=${episodeVideoId}` : `imported:dwarkesh/${guest}`;

  // Drop the pre-timestamp sentinel row from earlier imports (claims cascade).
  await db.from("everything_items").delete().eq("url", `imported:dwarkesh/${guest}`).neq("url", url);

  const { data: item, error: itemErr } = await db
    .from("everything_items")
    .upsert({ project_id: project, source: "podcast", url, title, status: "done" }, { onConflict: "url" })
    .select("id")
    .single();
  if (itemErr || !item) throw new Error(`Upsert item ${url}: ${itemErr?.message}`);

  // Idempotent re-run: drop this episode's claims (notes cascade) and re-import.
  await db.from("everything_claims").delete().eq("item_id", item.id);

  const results: RunResult[] = JSON.parse(fs.readFileSync(resultsPath, "utf8")).results;
  const timestamps = TIMESTAMPS[guest] ?? {};

  let imported = 0;
  for (const [i, r] of results.entries()) {
    if (!r.needsCorrection || !r.correction) continue;
    const ts = timestamps[String(i + 1)]; // snapshot is keyed by 1-based results index
    const contextUrl = ts
      ? `https://www.youtube.com/watch?v=${ts.videoId}&t=${ts.startSeconds}s`
      : (r.videoLink ?? null);
    const { data: claim, error: claimErr } = await db
      .from("everything_claims")
      .insert({
        item_id: item.id,
        claim: r.claim,
        judgement: r.judgement,
        context_quote: r.quote,
        context_url: contextUrl,
        start_seconds: ts?.startSeconds ?? null,
        end_seconds: ts ? estimateEndSeconds(ts.startSeconds, r.quote) : null,
        status: "note",
      })
      .select("id")
      .single();
    if (claimErr || !claim) throw new Error(`Insert claim: ${claimErr?.message}`);
    // Sources go inline at the end of the note text, like a normal community
    // note (the writer already does this for live notes; these runs kept them
    // in a separate list). LinkifiedText renders them clickable.
    const sources = r.sources ?? [];
    const noteText = sources.length ? `${r.correction} ${sources.join(" ")}` : r.correction;
    const { error: noteErr } = await db
      .from("everything_notes")
      .insert({ claim_id: claim.id, note: noteText });
    if (noteErr) throw new Error(`Insert note: ${noteErr.message}`);
    imported++;
  }
  return imported;
}

async function main() {
  const zip = process.argv[2] ?? DEFAULT_ZIP;
  if (!fs.existsSync(zip)) throw new Error(`Zip not found: ${zip}`);

  const work = fs.mkdtempSync(path.join(tmpdir(), "dwarkesh-"));
  try {
    execSync(`unzip -q -o "${zip}" -d "${work}"`);
    const root = path.join(work, "podcast_results");
    const dirs = fs.readdirSync(root).filter((d) => d.startsWith("youtube-claims-"));
    const project = await projectId();

    let total = 0;
    for (const dir of dirs) {
      const resultsPath = path.join(root, dir, "results.json");
      if (!fs.existsSync(resultsPath)) continue;
      const n = await importEpisode(dir, resultsPath, project);
      console.log(`  ${titleCase(guestFromDir(dir))}: ${n} notes`);
      total += n;
    }
    console.log(`Imported ${total} Dwarkesh notes across ${dirs.length} episodes`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[importDwarkesh] Fatal error:", err);
  process.exit(1);
});
