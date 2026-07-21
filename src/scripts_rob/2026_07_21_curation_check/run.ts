/**
 * Live check for the regular-pool topic curation (PR #293, merged 0812e9c
 * 2026-07-21T16:09Z). Read-only. Run a few hours after merge, then daily.
 *
 * What working looks like:
 *  1. NEW sightings with feed_size small/large (the curation's fingerprint —
 *     the pre-pass only ever writes xxl/xl) at roughly the preview's rates
 *     (~44 stage-1 matches/day pool-wide, ~14% confirmed).
 *  2. Confirmed sightings gaining processed_run_id via REGULAR-pass runs
 *     (topic treatment happened) — check the run outcome distribution.
 *  3. Curated candidates reaching submission (isMisinfo → reserve/backstop),
 *     bounded alongside pre-pass topic notes.
 *  4. Nothing broken: pre-pass sightings still flowing; no runs failed.
 *
 *   bun run src/scripts_rob/2026_07_21_curation_check/run.ts
 */

import { SupabaseLogger } from "../../api/supabaseClient";

const MERGED_AT = "2026-07-21T16:09:00Z";
const PRE_PASS_TIERS = new Set(["xxl", "xl"]);

const logger = new SupabaseLogger();
const chunk = <T,>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const hoursLive = ((Date.now() - Date.parse(MERGED_AT)) / 3.6e6).toFixed(1);

// ── 1. New sightings since merge, by feed tier ───────────────────────────────
const sightings = await logger.fetchAllRows<{
  id: number; tweet_id: string; topic_id: string; feed_size: string; first_seen_at: string;
  needs_note: boolean | null; selection_reason: string | null; processed_run_id: string | null;
}>(
  (c) => c.from("misinfo_monitoring_sightings")
    .select("id, tweet_id, topic_id, feed_size, first_seen_at, needs_note, selection_reason, processed_run_id")
    .gte("first_seen_at", MERGED_AT),
  "id", "sightings since merge");

console.log(`\n== curation check — ${hoursLive}h since merge ==`);
console.log(`\n1. new sightings since merge: ${sightings.length}`);
const byTier = new Map<string, { n: number; confirmed: number; rejected: number; unjudged: number }>();
for (const s of sightings) {
  const t = byTier.get(s.feed_size) ?? { n: 0, confirmed: 0, rejected: 0, unjudged: 0 };
  t.n++;
  if (s.needs_note === true) t.confirmed++;
  else if (s.needs_note === false) t.rejected++;
  else t.unjudged++;
  byTier.set(s.feed_size, t);
}
console.log("   tier    sighted  confirmed  rejected  unjudged");
for (const [tier, t] of [...byTier.entries()].sort()) {
  const src = PRE_PASS_TIERS.has(tier) ? "(pre-pass)" : "(CURATION — the new fingerprint)";
  console.log(`   ${tier.padEnd(6)} ${String(t.n).padStart(8)}  ${String(t.confirmed).padStart(9)}  ${String(t.rejected).padStart(8)}  ${String(t.unjudged).padStart(8)}  ${src}`);
}
if (![...byTier.keys()].some((t) => !PRE_PASS_TIERS.has(t))) {
  console.log("   ⚠ no small/large sightings yet — check GH logs for '[generate] topic curation:' lines");
}

// ── 2. Confirmed → processed with topic treatment ────────────────────────────
const confirmed = sightings.filter((s) => s.needs_note === true);
console.log(`\n2. confirmed since merge: ${confirmed.length}`);
const runIds = confirmed.map((s) => s.processed_run_id).filter((x): x is string => !!x);
const runById = new Map<string, { outcome: string | null; outcome_reason: string | null }>();
for (const b of chunk(runIds, 100)) {
  for (const r of await logger.fetchAllRows<{ id: string; outcome: string | null; outcome_reason: string | null }>(
    (c) => c.from("pipeline_runs").select("id, outcome, outcome_reason").in("id", b), "id")) {
    runById.set(r.id, r);
  }
}
for (const s of confirmed) {
  const r = s.processed_run_id ? runById.get(s.processed_run_id) : null;
  const status = r ? `${r.outcome}${r.outcome_reason ? `/${r.outcome_reason}` : ""}` : "pending (awaiting a free slot — reappears next runs)";
  console.log(`   [${s.feed_size}] ${s.tweet_id}  ${status}`);
  if (s.selection_reason) console.log(`      reason: ${s.selection_reason.slice(0, 100)}`);
}

// ── 3. Topic submissions in the last 24h (reserve accounting, both routes) ───
const notes = await logger.fetchAllRows<{ note_id: string; tweet_id: string; submitted_at: string | null }>(
  (c) => c.from("notes").select("note_id, tweet_id, submitted_at")
    .gte("submitted_at", new Date(Date.now() - 24 * 3.6e6).toISOString()),
  "note_id", "notes last 24h");
const allTopicTweets = new Set((await logger.fetchAllRows<{ id: number; tweet_id: string }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id"), "id", "all sightings")).map((s) => s.tweet_id));
const topicNotes = notes.filter((n) => allTopicTweets.has(n.tweet_id));
console.log(`\n3. topic submissions last 24h: ${topicNotes.length} (reserve budget 5/24h; both discovery routes count)`);
for (const n of topicNotes) console.log(`   ${(n.submitted_at ?? "").slice(0, 16)}  tweet ${n.tweet_id}`);

// ── 4. Health: any failed runs since merge ───────────────────────────────────
const failed = await logger.fetchAllRows<{ id: string; tweet_id: string; outcome_reason: string | null; created_at: string }>(
  (c) => c.from("pipeline_runs").select("id, tweet_id, outcome_reason, created_at")
    .gte("created_at", MERGED_AT).eq("outcome", "failed"),
  "id", "failed runs since merge");
console.log(`\n4. failed runs since merge: ${failed.length}${failed.length ? " ⚠" : ""}`);
for (const f of failed.slice(0, 5)) console.log(`   ${f.created_at.slice(0, 16)}  ${f.outcome_reason}  tweet ${f.tweet_id}`);
