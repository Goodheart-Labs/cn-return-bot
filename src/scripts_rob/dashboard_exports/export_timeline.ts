/**
 * Dashboard export #1 — the activity timeline (read-only).
 *
 * One row per day, from just before the 2026-07-16 speech onward: how much
 * topic conversation there was, and what we did about it. This is the spine
 * chart of the client dashboard ("curated topic" framing — no internal
 * naming in the JSON).
 *
 * Volume comes from three vantage points with different coverage windows,
 * exported as separate series (the chart can overlay them; they must not be
 * summed):
 *   - feed_matches: stage-1 predicate replayed over full XXL-feed snapshots,
 *     bucketed by POSTED day — the only series that sees before go-live
 *     (capture ran ~7/17–7/18).
 *   - sighted / selected: the live pre-pass, bucketed by first-seen day
 *     (starts at topic go-live 7/18-19).
 *   - captured: the hourly capture Action's JSONL (separate predicate, 7/18→).
 * Activity: notes_written (a note was fully produced: submitted + candidate +
 * cut at submission) and notes_submitted (notes table), bucketed by run/
 * submission day.
 *
 *   bun run src/scripts_rob/dashboard_exports/export_timeline.ts [--out <file>]
 */

import { readFileSync } from "node:fs";
import { SupabaseLogger } from "../../api/supabaseClient";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";

const TOPIC_ID = "trump_election_security";
const SPEECH_DAY = "2026-07-16";
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx !== -1 ? process.argv[outIdx + 1]! : `${import.meta.dir}/out/timeline.json`;

const topic = MISINFO_TOPICS.find((t) => t.id === TOPIC_ID)!;
const logger = new SupabaseLogger();
const day = (iso: string | null | undefined) => (iso ?? "").slice(0, 10) || null;

interface DayRow {
  date: string;
  /** XXL-feed snapshot rows matching the topic predicate, by posted day (coverage ~7/14–7/18 only). */
  feed_matches: number | null;
  feed_match_impressions: number | null;
  /** Live pre-pass: posts sighted / judged note-worthy, by first-seen day (go-live onward). */
  posts_sighted: number | null;
  posts_selected: number | null;
  selected_impressions: number | null;
  /** Hourly capture Action (separate predicate), by first-seen day. */
  captured: number | null;
  /** Our output. */
  notes_written: number;
  notes_submitted: number;
}
const rows = new Map<string, DayRow>();
const row = (d: string): DayRow => {
  const r = rows.get(d) ?? {
    date: d, feed_matches: null, feed_match_impressions: null, posts_sighted: null,
    posts_selected: null, selected_impressions: null, captured: null, notes_written: 0, notes_submitted: 0,
  };
  rows.set(d, r);
  return r;
};

// ── Volume: feed snapshots (by posted day) ───────────────────────────────────
const feed = await logger.fetchAllRows<{ tweet_id: string; text: string | null; posted_at: string | null; impressions: number | null; referenced_tweet_data: any }>(
  (c) => c.from("feed_tweets").select("tweet_id, text, posted_at, impressions, referenced_tweet_data"),
  "tweet_id", "feed_tweets");
for (const t of feed) {
  const d = day(t.posted_at);
  if (!d) continue;
  const blob = `${t.text ?? ""}\n${t.referenced_tweet_data?.text ?? ""}`.toLowerCase();
  if (!topic.matches(blob)) continue;
  const r = row(d);
  r.feed_matches = (r.feed_matches ?? 0) + 1;
  r.feed_match_impressions = (r.feed_match_impressions ?? 0) + (t.impressions ?? 0);
}

// ── Volume: live sightings (by first-seen day) ───────────────────────────────
const sightings = await logger.fetchAllRows<{ id: number; tweet_id: string; first_seen_at: string; needs_note: boolean | null; impression_count: number | null }>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, tweet_id, first_seen_at, needs_note, impression_count").eq("topic_id", TOPIC_ID),
  "id", "sightings");
const topicTweetIds = new Set(sightings.map((s) => s.tweet_id));
for (const s of sightings) {
  const d = day(s.first_seen_at);
  if (!d) continue;
  const r = row(d);
  r.posts_sighted = (r.posts_sighted ?? 0) + 1;
  if (s.needs_note === true) {
    r.posts_selected = (r.posts_selected ?? 0) + 1;
    r.selected_impressions = (r.selected_impressions ?? 0) + (s.impression_count ?? 0);
  }
}

// ── Volume: hourly capture JSONL (by first-seen day) ─────────────────────────
for (const line of readFileSync("capture-data/trump-election-fraud.jsonl", "utf8").split("\n").filter(Boolean)) {
  const rec = JSON.parse(line) as { first_seen: string };
  const d = `${rec.first_seen.slice(0, 4)}-${rec.first_seen.slice(4, 6)}-${rec.first_seen.slice(6, 8)}`;
  const r = row(d);
  r.captured = (r.captured ?? 0) + 1;
}

// ── Activity: notes written (pipeline_runs on topic tweets) ──────────────────
const WRITTEN_REASONS = new Set(["daily_limit_reached", "below_velocity_floor"]);
const runs = await logger.fetchAllRows<{ id: string; tweet_id: string; created_at: string; outcome: string | null; outcome_reason: string | null }>(
  (c) => c.from("pipeline_runs").select("id, tweet_id, created_at, outcome, outcome_reason").gte("created_at", SPEECH_DAY),
  "id", "pipeline_runs");
for (const rn of runs) {
  if (!topicTweetIds.has(rn.tweet_id)) continue;
  const wrote = rn.outcome === "submitted" || rn.outcome === "candidate" || WRITTEN_REASONS.has(rn.outcome_reason ?? "");
  if (!wrote) continue;
  const d = day(rn.created_at);
  if (d) row(d).notes_written++;
}

// ── Activity: notes submitted (notes table) ──────────────────────────────────
const notes = await logger.fetchAllRows<{ note_id: string; tweet_id: string; submitted_at: string | null }>(
  (c) => c.from("notes").select("note_id, tweet_id, submitted_at").gte("submitted_at", SPEECH_DAY),
  "note_id", "notes");
for (const n of notes) {
  if (!topicTweetIds.has(n.tweet_id)) continue;
  const d = day(n.submitted_at);
  if (d) row(d).notes_submitted++;
}

// ── Emit ─────────────────────────────────────────────────────────────────────
const days = [...rows.values()].filter((r) => r.date >= "2026-07-14").sort((a, b) => a.date.localeCompare(b.date));
const out = {
  generated_at: new Date().toISOString(),
  topic: "Election-security address (2026-07-16) — curated topic",
  speech_day: SPEECH_DAY,
  series_notes: {
    feed_matches: "full-feed snapshot replay by posted day; capture window ~7/14-7/18 only",
    posts_sighted: "live monitoring by first-seen day; starts at go-live 7/18",
    captured: "hourly capture job, separate match criteria, 7/18 onward",
    caution: "volume series have different vantage points and windows — overlay, never sum",
  },
  days,
};
await Bun.write(OUT, JSON.stringify(out, null, 2));

console.log(`\ntimeline → ${OUT}\n`);
console.log("date        feed_matches  sighted  selected  captured  written  submitted");
for (const r of days) {
  const f = (v: number | null) => (v == null ? "–" : String(v));
  console.log(
    `${r.date}${r.date === SPEECH_DAY ? "*" : " "} ${f(r.feed_matches).padStart(12)}  ${f(r.posts_sighted).padStart(7)}  ${f(r.posts_selected).padStart(8)}  ${f(r.captured).padStart(8)}  ${String(r.notes_written).padStart(7)}  ${String(r.notes_submitted).padStart(9)}`,
  );
}
console.log("(* = speech day)");
