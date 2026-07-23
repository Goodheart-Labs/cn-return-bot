/**
 * Dashboard export #3 — the notes themselves (read-only).
 *
 * One client-safe record per note submitted on the curated topic: where it
 * went (links, not tweet content), what it said (our note text is our own
 * public writing), how X's raters responded, views, and the upper bound on
 * time-to-display. Feeds the dashboard's "notes" and "outcomes" sections and
 * the verifiability story: every note_id here is checkable in X's public
 * Community Notes data.
 *
 * Ratings come from note_ratings_from_public_dump (refreshed daily from the
 * public dump; ~48h lag). Status timing comes from the local dump copy of
 * noteStatusHistory (./cn-data), streamed and filtered to our note ids; when
 * the file is absent the timing fields are null and dump_as_of records that.
 *
 *   bun run src/scripts_rob/dashboard_exports/export_notes.ts [--out <file>] [--dump-dir ./cn-data]
 */

import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { SupabaseLogger } from "../../api/supabaseClient";

const TOPIC_ID = "trump_election_security";
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx !== -1 ? process.argv[outIdx + 1]! : `${import.meta.dir}/out/notes.json`;
const dumpIdx = process.argv.indexOf("--dump-dir");
const DUMP_DIR = dumpIdx !== -1 ? process.argv[dumpIdx + 1]! : "./cn-data";

const logger = new SupabaseLogger();
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
const hoursBetween = (fromMs: number, toMs: number) => Number(((toMs - fromMs) / 3.6e6).toFixed(1));

// ── The canonical topic join: sightings → runs → notes ───────────────────────
const sightings = await logger.fetchAllRows<{
  id: number; tweet_id: string; first_seen_at: string; impression_count: number | null;
  processed_run_id: string | null;
}>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, tweet_id, first_seen_at, impression_count, processed_run_id")
    .eq("topic_id", TOPIC_ID)
    .not("processed_run_id", "is", null),
  "id", "processed sightings");
const sightingByTweet = new Map(sightings.map((s) => [s.tweet_id, s]));

interface Run { id: string; tweet_id: string; note_id: string | null }
const runs: Run[] = [];
for (const ids of chunk(sightings.map((s) => s.processed_run_id!), 100)) {
  runs.push(...await logger.fetchAllRows<Run>(
    (c) => c.from("pipeline_runs").select("id, tweet_id, note_id").in("id", ids),
    "id"));
}
const runsWithNote = runs.filter((r): r is Run & { note_id: string } => !!r.note_id);
const noteIds = [...new Set(runsWithNote.map((r) => r.note_id))];
console.error(`[notes] ${sightings.length} processed sightings → ${noteIds.length} submitted notes`);

interface NoteRow { note_id: string; tweet_id: string; note_text: string | null; cn_status: string | null; submitted_at: string | null; view_count: number | null }
const noteRows: NoteRow[] = [];
for (const ids of chunk(noteIds, 100)) {
  noteRows.push(...await logger.fetchAllRows<NoteRow>(
    (c) => c.from("notes").select("note_id, tweet_id, note_text, cn_status, submitted_at, view_count").in("note_id", ids),
    "note_id"));
}

interface RatingRow { note_id: string; helpful_count: number | null; somewhat_helpful_count: number | null; not_helpful_count: number | null }
const ratingRows: RatingRow[] = [];
for (const ids of chunk(noteIds, 100)) {
  ratingRows.push(...await logger.fetchAllRows<RatingRow>(
    (c) => c.from("note_ratings_from_public_dump")
      .select("note_id, helpful_count, somewhat_helpful_count, not_helpful_count")
      .in("note_id", ids),
    "note_id"));
}
const ratingByNote = new Map(ratingRows.map((r) => [r.note_id, r]));

const tweetIds = [...new Set(noteRows.map((n) => n.tweet_id))];
const tweetRows: { tweet_id: string; posted_at: string | null }[] = [];
for (const ids of chunk(tweetIds, 100)) {
  tweetRows.push(...await logger.fetchAllRows<(typeof tweetRows)[number]>(
    (c) => c.from("tweets").select("tweet_id, posted_at").in("tweet_id", ids),
    "tweet_id"));
}
const postedAtByTweet = new Map(tweetRows.map((t) => [t.tweet_id, t.posted_at]));

// ── Status timing from the local public-dump copy ────────────────────────────
interface StatusTiming {
  created_at_millis: number;
  first_non_nmr_status: string | null;
  hours_to_first_non_nmr: number | null;
  current_status_in_dump: string | null;
  time_to_display_hours_upper_bound: number | null;
}
const timingByNote = new Map<string, StatusTiming>();
let dumpAsOf: string | null = null;

const statusFiles = existsSync(DUMP_DIR)
  ? readdirSync(DUMP_DIR).filter((f) => f.startsWith("noteStatusHistory") && f.endsWith(".tsv")).sort()
  : [];
if (statusFiles.length && noteIds.length) {
  const wanted = new Set(noteIds);
  dumpAsOf = statSync(`${DUMP_DIR}/${statusFiles[0]}`).mtime.toISOString();
  for (const file of statusFiles) {
    const rl = createInterface({ input: createReadStream(`${DUMP_DIR}/${file}`), crlfDelay: Infinity });
    let header: string[] | null = null;
    let idx: Record<string, number> = {};
    for await (const line of rl) {
      const cols = line.split("\t");
      if (!header) {
        header = cols;
        idx = Object.fromEntries(header.map((h, i) => [h, i]));
        continue;
      }
      const noteId = cols[idx.noteId!];
      if (!noteId || !wanted.has(noteId)) continue;
      const created = Number(cols[idx.createdAtMillis!]);
      const firstNonNmrTs = Number(cols[idx.timestampMillisOfFirstNonNMRStatus!]);
      const firstNonNmrStatus = cols[idx.firstNonNMRStatus!] || null;
      const currentTs = Number(cols[idx.timestampMillisOfCurrentStatus!]);
      const currentStatus = cols[idx.currentStatus!] || null;
      // Upper bound: the earliest dump timestamp at which the note was Helpful.
      const displayBound =
        firstNonNmrStatus === HELPFUL && firstNonNmrTs > 0 ? hoursBetween(created, firstNonNmrTs)
        : currentStatus === HELPFUL && currentTs > 0 ? hoursBetween(created, currentTs)
        : null;
      timingByNote.set(noteId, {
        created_at_millis: created,
        first_non_nmr_status: firstNonNmrStatus,
        hours_to_first_non_nmr: firstNonNmrTs > 0 && created > 0 ? hoursBetween(created, firstNonNmrTs) : null,
        current_status_in_dump: currentStatus,
        time_to_display_hours_upper_bound: displayBound,
      });
    }
  }
  console.error(`[notes] dump timing found for ${timingByNote.size}/${noteIds.length} notes (dump as of ${dumpAsOf})`);
} else {
  console.error(`[notes] no noteStatusHistory files under ${DUMP_DIR} — timing fields will be null`);
}

// ── Assemble ─────────────────────────────────────────────────────────────────
const notes = noteRows
  .map((n) => {
    const sighting = sightingByTweet.get(n.tweet_id);
    const posted = postedAtByTweet.get(n.tweet_id) ?? null;
    const firstSeen = sighting?.first_seen_at ?? null;
    const impressions = sighting?.impression_count ?? null;
    const hoursOld = posted && firstSeen ? (Date.parse(firstSeen) - Date.parse(posted)) / 3.6e6 : null;
    const velocity = impressions != null && hoursOld != null && hoursOld > 0
      ? Math.round(impressions / hoursOld) : null;
    const rating = ratingByNote.get(n.note_id);
    const timing = timingByNote.get(n.note_id);
    return {
      note_id: n.note_id,
      note_url: `https://x.com/i/birdwatch/n/${n.note_id}`,
      tweet_url: `https://x.com/i/status/${n.tweet_id}`,
      tweet: {
        posted_at: posted,
        first_seen_at: firstSeen,
        impressions_at_first_seen: impressions,
        impressions_per_hour_at_first_seen: velocity,
      },
      note_text: n.note_text,
      submitted_at: n.submitted_at,
      status: n.cn_status,
      displayed: n.cn_status === HELPFUL,
      view_count: n.view_count ?? null,
      ratings: rating
        ? {
            helpful: rating.helpful_count ?? 0,
            somewhat_helpful: rating.somewhat_helpful_count ?? 0,
            not_helpful: rating.not_helpful_count ?? 0,
            total: (rating.helpful_count ?? 0) + (rating.somewhat_helpful_count ?? 0) + (rating.not_helpful_count ?? 0),
          }
        : null,
      status_timing: timing
        ? {
            first_non_nmr_status: timing.first_non_nmr_status,
            hours_to_first_non_nmr: timing.hours_to_first_non_nmr,
            current_status_in_dump: timing.current_status_in_dump,
            time_to_display_hours_upper_bound: timing.time_to_display_hours_upper_bound,
          }
        : null,
    };
  })
  .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));

const ratedNotes = notes.filter((n) => (n.ratings?.total ?? 0) > 0);
const summary = {
  notes_submitted: notes.length,
  notes_rated: ratedNotes.length,
  notes_displayed: notes.filter((n) => n.displayed).length,
  total_ratings: ratedNotes.reduce((s, n) => s + (n.ratings?.total ?? 0), 0),
  total_note_views: notes.reduce((s, n) => s + (n.view_count ?? 0), 0),
  noted_post_impressions_at_first_seen: notes.reduce((s, n) => s + (n.tweet.impressions_at_first_seen ?? 0), 0),
};

const out = {
  generated_at: new Date().toISOString(),
  topic: "Election-security address (2026-07-16) — curated topic",
  field_notes: {
    ratings: "from X's public Community Notes data (~48h lag); null = not yet present in the dump",
    view_count: "note views from the contributor page; null = not yet observed",
    time_to_display_hours_upper_bound: "hours from note creation to the earliest public-dump timestamp with a Helpful status; an upper bound because the dump records status changes, not first display",
    verifiability: "every note_id is present in X's public Community Notes data and can be checked independently",
    dump_as_of: "modification time of the local noteStatusHistory dump copy used for status_timing",
  },
  dump_as_of: dumpAsOf,
  summary,
  notes,
};
await Bun.write(OUT, JSON.stringify(out, null, 2));

console.log(`\nnotes → ${OUT}\n`);
console.log(`summary: ${JSON.stringify(summary, null, 2)}`);
console.log("\nsubmitted_at      status                        ratings h/sh/nh  views  velocity/h");
for (const n of notes) {
  const r = n.ratings ? `${n.ratings.helpful}/${n.ratings.somewhat_helpful}/${n.ratings.not_helpful}` : "–";
  const v = n.tweet.impressions_per_hour_at_first_seen;
  console.log(
    `${(n.submitted_at ?? "?").slice(0, 16).padEnd(16)}  ${(n.status ?? "?").padEnd(28)}  ${r.padEnd(15)}  ${String(n.view_count ?? "–").padStart(5)}  ${v != null ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)) : "–"}`,
  );
}
