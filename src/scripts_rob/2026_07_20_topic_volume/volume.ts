/**
 * Topic volume: how many tweets has the trump_election_security topic seen,
 * per day, across our three vantage points — and at what impression scale?
 *
 * 1. feed_tweets (full XXL-feed snapshots, PR #273): run the topic's ACTUAL
 *    stage-1 predicate (topics.ts matches()) over every captured feed tweet →
 *    matches/day vs total feed rows/day, with impressions. This measures the
 *    criteria itself over the widest pool we have.
 * 2. misinfo_monitoring_sightings: what the live pre-pass keyword-matched,
 *    and the stage-2 (Gemini) needs_note verdict split, per day.
 * 3. capture-data/trump-election-fraud.jsonl (hourly capture Action): tweets
 *    per first-seen day with views at capture time.
 *
 * Read-only. Run: bun run src/scripts_rob/2026_07_20_topic_volume/volume.ts
 */

import { readFileSync } from "node:fs";
import { SupabaseLogger } from "../../api/supabaseClient";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";

const topic = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!;
const logger = new SupabaseLogger();
const day = (iso: string | null | undefined) => (iso ?? "").slice(0, 10) || "unknown";
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

// ── 1. feed_tweets vs the stage-1 predicate ──────────────────────────────────
const feed = await logger.fetchAllRows<{
  tweet_id: string; text: string | null; posted_at: string | null;
  impressions: number | null; referenced_tweet_data: any;
}>(
  (c) => c.from("feed_tweets").select("tweet_id, text, posted_at, impressions, referenced_tweet_data"),
  "tweet_id",
  "feed_tweets",
);

interface DayAgg { total: number; matched: number; matchedImpr: number; topImpr: number }
const feedByDay = new Map<string, DayAgg>();
for (const t of feed) {
  const d = day(t.posted_at);
  const agg = feedByDay.get(d) ?? { total: 0, matched: 0, matchedImpr: 0, topImpr: 0 };
  agg.total++;
  const blob = `${t.text ?? ""}\n${t.referenced_tweet_data?.text ?? ""}`.toLowerCase();
  if (topic.matches(blob)) {
    agg.matched++;
    agg.matchedImpr += t.impressions ?? 0;
    agg.topImpr = Math.max(agg.topImpr, t.impressions ?? 0);
  }
  feedByDay.set(d, agg);
}
console.log(`\n== 1. feed_tweets (${feed.length} captured feed tweets) vs stage-1 predicate ==`);
console.log("posted_day   feed_rows  matched  match%  matched_impressions  top_tweet");
for (const [d, a] of [...feedByDay.entries()].sort()) {
  if (a.total < 10) continue; // skip trace days
  console.log(
    `${d}   ${String(a.total).padStart(8)}  ${String(a.matched).padStart(7)}  ${((100 * a.matched) / a.total).toFixed(1).padStart(5)}%  ${fmt(a.matchedImpr).padStart(19)}  ${fmt(a.topImpr).padStart(9)}`,
  );
}

// ── 2. sightings: live matches + stage-2 verdicts ───────────────────────────
const sightings = await logger.fetchAllRows<{
  id: number; tweet_id: string; first_seen_at: string; needs_note: boolean | null;
  impression_count: number | null; processed_run_id: string | null;
}>(
  (c) => c
    .from("misinfo_monitoring_sightings")
    .select("id, tweet_id, first_seen_at, needs_note, impression_count, processed_run_id")
    .eq("topic_id", "trump_election_security"),
  "id",
  "sightings",
);
console.log(`\n== 2. live pre-pass sightings (${sightings.length}) — stage-2 verdicts ==`);
console.log("seen_day     matched  needs_note  no_note  processed  needs_note_impressions");
const sByDay = new Map<string, { m: number; y: number; n: number; p: number; yImpr: number }>();
for (const s of sightings) {
  const d = day(s.first_seen_at);
  const a = sByDay.get(d) ?? { m: 0, y: 0, n: 0, p: 0, yImpr: 0 };
  a.m++;
  if (s.needs_note === true) { a.y++; a.yImpr += s.impression_count ?? 0; }
  if (s.needs_note === false) a.n++;
  if (s.processed_run_id) a.p++;
  sByDay.set(d, a);
}
for (const [d, a] of [...sByDay.entries()].sort()) {
  console.log(
    `${d}   ${String(a.m).padStart(7)}  ${String(a.y).padStart(10)}  ${String(a.n).padStart(7)}  ${String(a.p).padStart(9)}  ${fmt(a.yImpr).padStart(22)}`,
  );
}

// ── 3. hourly capture JSONL ─────────────────────────────────────────────────
const lines = readFileSync("capture-data/trump-election-fraud.jsonl", "utf8").split("\n").filter(Boolean);
const cByDay = new Map<string, { n: number; views: number }>();
for (const line of lines) {
  const r = JSON.parse(line) as { first_seen: string; views?: number };
  // first_seen format: 20260718T042858Z
  const d = `${r.first_seen.slice(0, 4)}-${r.first_seen.slice(4, 6)}-${r.first_seen.slice(6, 8)}`;
  const a = cByDay.get(d) ?? { n: 0, views: 0 };
  a.n++;
  a.views += r.views ?? 0;
  cByDay.set(d, a);
}
console.log(`\n== 3. hourly capture JSONL (${lines.length} tweets, separate predicate, since 7/18) ==`);
console.log("seen_day     tweets  views_at_capture");
for (const [d, a] of [...cByDay.entries()].sort()) {
  console.log(`${d}   ${String(a.n).padStart(6)}  ${fmt(a.views).padStart(16)}`);
}
