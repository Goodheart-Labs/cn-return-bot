/**
 * Seed ranking_decisions from history so the bar has a trailing window on day one.
 *
 *   bun run backfill-ranking-decisions [--days 30] [--dry-run]
 *
 * One row per candidate that reached the submit stage (submitted, or rejected at
 * submission), scored under every registered scorer from the tweets row and the
 * stored eval score. policy = "backfill", decision = "backfill:<outcome_reason>".
 */
import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { featuresFromTweetRow, flagCount, type TweetRow } from "../pipeline/ranking/features";
import { FLAG_CUTS_2026_08, SCORERS } from "../pipeline/ranking/scorers";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const days = Number(arg("days", "30"));
const dryRun = process.argv.includes("--dry-run");
const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
const client = getSupabaseClient();

async function pageAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build().range(offset, offset + 999);
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}
async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 80) out.push(...(await fetch(ids.slice(i, i + 80))));
  return out;
}

type Run = { id: string; tweet_id: string; created_at: string; outcome: string; outcome_reason: string | null; final_stage: string | null };
const submitted = await pageAll<Run>(() =>
  client.from("pipeline_runs").select("id,tweet_id,created_at,outcome,outcome_reason,final_stage").eq("outcome", "submitted").gte("created_at", since).order("created_at"),
);
const rejectedAtSubmit = await pageAll<Run>(() =>
  client.from("pipeline_runs").select("id,tweet_id,created_at,outcome,outcome_reason,final_stage").eq("outcome", "rejected").eq("final_stage", "submission").gte("created_at", since).order("created_at"),
);
const runs = [...submitted, ...rejectedAtSubmit];
console.log(`[backfill] ${submitted.length} submitted + ${rejectedAtSubmit.length} rejected-at-submit runs since ${since.slice(0, 10)}`);

let existing = new Set<string>();
try {
  existing = new Set(
    (await pageAll<{ pipeline_run_id: string }>(() =>
      client.from("ranking_decisions").select("pipeline_run_id").gte("decided_at", since).order("decided_at"),
    )).map((r) => r.pipeline_run_id),
  );
} catch (err) {
  console.warn("[backfill] could not read ranking_decisions (migration 085 applied?):", (err as Error).message ?? err);
  if (!dryRun) process.exit(1);
}

const tweets = new Map<string, TweetRow>();
for (const t of await inChunks([...new Set(runs.map((r) => r.tweet_id))], async (chunk) => {
  const { data, error } = await client.from("tweets").select("tweet_id,posted_at,first_seen_at,impressions,author_followers,has_video,has_photo").in("tweet_id", chunk);
  if (error) throw error;
  return data as (TweetRow & { tweet_id: string })[];
})) tweets.set(t.tweet_id, t);

const evalByRun = new Map<string, number>();
for (const s of await inChunks(runs.map((r) => r.id), async (chunk) => {
  const { data, error } = await client.from("pipeline_scores").select("pipeline_run_id,score_value").eq("score_type", "evaluation").in("pipeline_run_id", chunk);
  if (error) throw error;
  return data as { pipeline_run_id: string; score_value: number | null }[];
})) if (s.score_value !== null) evalByRun.set(s.pipeline_run_id, Number(s.score_value));

const rows: Record<string, unknown>[] = [];
let skipped = 0;
for (const r of runs) {
  if (existing.has(r.id)) { skipped++; continue; }
  const t = tweets.get(r.tweet_id);
  if (!t) { skipped++; continue; }
  const f = featuresFromTweetRow(t);
  const evalScore = evalByRun.get(r.id) ?? null;
  const scores = Object.fromEntries(Object.values(SCORERS).map((s) => [s.name, s.scoreSubmit(f, evalScore)]));
  rows.push({
    decided_at: r.created_at,
    pipeline_run_id: r.id,
    tweet_id: r.tweet_id,
    policy: "backfill",
    scorer: "flags_then_eval",
    submit_score: scores.flags_then_eval,
    scores,
    flags: flagCount(f, FLAG_CUTS_2026_08),
    eval_score: evalScore,
    decision: `backfill:${r.outcome === "submitted" ? "submitted" : r.outcome_reason ?? "rejected"}`,
  });
}
console.log(`[backfill] ${rows.length} rows to insert, ${skipped} skipped (already present or no tweet row)`);
if (dryRun) process.exit(0);
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await client.from("ranking_decisions").insert(rows.slice(i, i + 500));
  if (error) throw error;
}
console.log("[backfill] done");
