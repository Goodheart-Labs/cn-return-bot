/**
 * Import a podcast claim-pipeline run (checkYoutubeClaims results.json) into
 * the Common Notes tables — ADDITIVELY (never wipes; safe with live votes).
 *
 * Encodes the verbatim-display convention (Nathan's #247 rule, 2026-07-14):
 * the displayed claim line must be word-for-word source text. Concretely:
 *   - display claim := the pipeline's verbatim `context` excerpt
 *   - the restated claim (pipeline `claim`) is NOT displayed anywhere
 *   - if a transcript.txt is provided, the excerpt must appear verbatim in it
 *     (whitespace-normalized) or the note is SKIPPED with a warning
 *   - context_paragraph := ±40s transcript window around the claim, and must
 *     contain the excerpt so the side-column bolding works
 *
 * Only results with needsCorrection are imported (a note needs a correction).
 *
 *   bun run src/everything/importClaimResults.ts \
 *     --results dataset_runs/<run>/results.json \
 *     --transcript dataset_runs/<run>/transcript.txt \
 *     --title "Adam Brown" [--project dwarkesh]
 */

import "dotenv/config";
import * as fs from "fs";
import { getSupabaseClient } from "../api/supabaseClient";

const CLIP_PAD_SECONDS = 1;
const PARAGRAPH_WINDOW_S = 40;

interface ClaimResult {
  claim: string;
  context: string;
  correction: string;
  sources: string[];
  needsCorrection: boolean;
  timestampSeconds?: number;
  endTimestampSeconds?: number;
  videoLink?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Parse "[h:mm:ss] text" / "[m:ss] text" transcript lines. */
function transcriptCues(path: string): Array<{ s: number; text: string }> {
  return fs
    .readFileSync(path, "utf8")
    .split("\n")
    .map((line) => {
      const m = line.match(/^\[(?:(\d+):)?(\d+):(\d+)\]\s*(.*)/);
      if (!m) return null;
      const [, h, mm, ss, text] = m;
      return { s: (h ? +h * 3600 : 0) + +mm! * 60 + +ss!, text: text! };
    })
    .filter((c): c is { s: number; text: string } => !!c);
}

async function main() {
  const resultsPath = arg("results");
  const title = arg("title");
  if (!resultsPath || !title) throw new Error("--results and --title are required");
  const projectSlug = arg("project") ?? "dwarkesh";
  const transcriptPath = arg("transcript");

  const parsed = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  const allResults = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(allResults)) throw new Error(`${resultsPath}: expected an array or an object with a results array`);
  const results: ClaimResult[] = allResults.filter((r: ClaimResult) => r.needsCorrection);
  if (results.length === 0) {
    console.log("no needsCorrection results — nothing to import");
    return;
  }
  const video = (Array.isArray(parsed) ? undefined : parsed.video) as { url?: string; uploadDate?: string } | undefined;
  const videoUrl = video?.url ?? results[0]?.videoLink?.replace(/[?&]t=\d+s$/, "");
  if (!videoUrl) throw new Error("could not determine video URL from results");

  const cues = transcriptPath ? transcriptCues(transcriptPath) : null;
  const transcriptNorm = cues ? norm(cues.map((c) => c.text).join(" ")) : null;

  const db = getSupabaseClient();
  const { data: project, error: projectErr } = await db
    .from("everything_projects")
    .select("id")
    .eq("slug", projectSlug)
    .single();
  if (!project) throw new Error(`project '${projectSlug}': ${projectErr?.message ?? "not found"}`);

  const { data: item, error: itemErr } = await db
    .from("everything_items")
    .upsert(
      {
        project_id: project.id,
        source: "podcast",
        url: videoUrl,
        title,
        published_at: video?.uploadDate ?? null,
        status: "done",
      },
      { onConflict: "url" },
    )
    .select("id")
    .single();
  if (itemErr || !item) throw new Error(`upsert item: ${itemErr?.message}`);

  let imported = 0;
  for (const r of results) {
    const excerpt = r.context?.trim();
    if (!excerpt) {
      console.warn(`SKIP (missing/empty context excerpt): ${r.claim?.slice(0, 70) ?? "<no claim text>"}`);
      continue;
    }

    // The verbatim gate: the displayed line must exist word-for-word in the
    // transcript when we have one. No transcript → trust the pipeline excerpt
    // but say so.
    if (transcriptNorm && !transcriptNorm.includes(norm(excerpt))) {
      console.warn(`SKIP (not verbatim in transcript): ${excerpt.slice(0, 70)}…`);
      continue;
    }
    if (!transcriptNorm) console.warn(`note: no transcript provided — excerpt unverified: ${excerpt.slice(0, 50)}…`);

    // Dedup by position, not text — an earlier import may have chosen a
    // different display subspan for the same moment in the episode. A missing
    // timestamp would dedup everything at t=0, so it disqualifies the result.
    if (r.timestampSeconds == null) {
      console.warn(`SKIP (no timestamp — position-based dedup impossible): ${excerpt.slice(0, 70)}…`);
      continue;
    }
    const claimTs = r.timestampSeconds;
    const startSeconds = Math.max(0, Math.floor(claimTs) - CLIP_PAD_SECONDS);
    const { data: nearby, error: nearbyErr } = await db
      .from("everything_claims")
      .select("id, start_seconds")
      .eq("item_id", item.id)
      .gte("start_seconds", startSeconds - 10)
      .lte("start_seconds", startSeconds + 10);
    if (nearbyErr) throw new Error(`nearby-claims lookup: ${nearbyErr.message}`);
    if (nearby && nearby.length > 0) {
      console.log(`skip (claim already exists at ~${startSeconds}s): ${excerpt.slice(0, 50)}…`);
      continue;
    }

    // Paragraph: transcript window around the claim, guaranteed to contain the
    // excerpt (falls back to the excerpt itself).
    let paragraph = excerpt;
    if (cues) {
      const windowText = cues
        .filter((c) => c.s >= claimTs - PARAGRAPH_WINDOW_S && c.s <= (r.endTimestampSeconds ?? claimTs) + PARAGRAPH_WINDOW_S / 2)
        .map((c) => c.text)
        .join(" ");
      if (norm(windowText).includes(norm(excerpt))) paragraph = windowText;
    }

    const endSeconds = Math.ceil(r.endTimestampSeconds ?? claimTs + 15) + CLIP_PAD_SECONDS;
    const { data: claimRow, error: claimErr } = await db
      .from("everything_claims")
      .insert({
        item_id: item.id,
        claim: excerpt,
        judgement: "uncertain",
        context_quote: excerpt,
        context_paragraph: paragraph,
        context_url: `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}t=${startSeconds}s`,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        status: "note",
      })
      .select("id")
      .single();
    if (claimErr || !claimRow) throw new Error(`insert claim: ${claimErr?.message}`);

    const { error: noteErr } = await db
      .from("everything_notes")
      .insert({ claim_id: claimRow.id, note: r.correction, sources: r.sources ?? [] });
    if (noteErr) throw new Error(`insert note: ${noteErr.message}`);
    imported++;
    console.log(`imported: ${excerpt.slice(0, 60)}…`);
  }
  console.log(`\n${imported}/${results.length} corrections imported for "${title}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
