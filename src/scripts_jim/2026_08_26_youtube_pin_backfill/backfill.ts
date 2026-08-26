/**
 * Backfill for GOO-52: noted YouTube claims whose timestamps never snapped.
 *
 * The old contextTimeSpan only matched whole cues contained inside the claim's
 * context quote, so a quote shorter than a cue (or one straddling a cue
 * boundary) got no timestamp, and the extension never pinned its note on the
 * player. This script recomputes the span for every noted YouTube claim with a
 * null start_seconds, using the fixed contextTimeSpan, and writes the result
 * back.
 *
 *   bun run src/scripts_jim/2026_08_26_youtube_pin_backfill/backfill.ts [<cues-dir>]
 *
 * By default the cues come from yt-dlp. YouTube blocks subtitle fetches from
 * datacenter IPs, so this must run either from a residential IP or with
 * YTDLP_PROXY_URL set; the GitHub Action "Backfill YouTube Timestamps" runs it
 * with the repo's proxy secret. Alternatively <cues-dir> can hold one
 * <videoId>.json per video (an array of { start, end, text } cues) which is
 * then used instead of fetching. Needs SUPABASE_URL + SUPABASE_SERVICE_KEY.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { contextTimeSpan } from "../../everything/pipeline/extractClaims";
import { extractYoutubeVideoId } from "../../everything-shared/pageUrls";
import { fetchTimedTranscript, type SubtitleCue } from "../../pipeline/media/ytDlpDownload";

const cuesDir = process.argv[2];

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

function loadCues(videoId: string, videoUrl: string): SubtitleCue[] | null {
  const cuesFile = cuesDir ? path.join(cuesDir, `${videoId}.json`) : null;
  if (cuesFile && fs.existsSync(cuesFile)) return JSON.parse(fs.readFileSync(cuesFile, "utf-8"));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `cues-${videoId}-`));
  try {
    return fetchTimedTranscript(videoUrl, tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const { data: claims, error } = await db
  .from("everything_claims")
  .select("id, context_quote, context_paragraph, start_seconds, everything_items!inner(url, source)")
  .eq("status", "note")
  .is("start_seconds", null)
  .eq("everything_items.source", "youtube");
if (error) throw error;
console.log(`${claims?.length ?? 0} noted YouTube claim(s) without a timestamp`);

for (const claim of claims ?? []) {
  const item = claim.everything_items as unknown as { url: string };
  const videoId = extractYoutubeVideoId(item.url);
  if (!videoId) {
    console.log(`claim ${claim.id}: no video id in ${item.url}, skipping`);
    continue;
  }
  const cues = loadCues(videoId, item.url);
  if (!cues?.length) {
    console.log(`claim ${claim.id}: no cues available for ${item.url}, skipping`);
    continue;
  }
  let span = contextTimeSpan(claim.context_quote ?? "", cues);
  if (span.start === undefined) span = contextTimeSpan(claim.context_paragraph ?? "", cues);
  if (span.start === undefined) {
    console.log(`claim ${claim.id}: context still does not snap onto the cues, leaving untouched`);
    continue;
  }
  const start = Math.floor(span.start);
  const end = span.end !== undefined ? Math.ceil(span.end) : null;
  const contextUrl = `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, start)}s`;
  const { error: upErr } = await db
    .from("everything_claims")
    .update({ start_seconds: start, end_seconds: end, context_url: contextUrl })
    .eq("id", claim.id);
  if (upErr) throw upErr;
  console.log(`claim ${claim.id}: snapped to ${start}-${end}s (${item.url})`);
}
