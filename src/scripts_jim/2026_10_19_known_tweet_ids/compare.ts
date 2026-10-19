/**
 * GOO-423. Checks that the new candidate-only lookups give the same answer as
 * the old full-table scans, on a sample of real tweet ids from prod. Read-only.
 *
 * The old scans are rebuilt here from the code on main before the change: every
 * row of tweets, notes and rejected pipeline_runs, and the last 48 hours of runs.
 *
 *   bun run src/scripts_jim/2026_10_19_known_tweet_ids/compare.ts
 */
import "dotenv/config";
import { getSupabaseClient, SupabaseLogger } from "../../api/supabaseClient";
import { fetchAllRows } from "../../everything-core/paging";
import { RETRY_WINDOW_HOURS, retryEligibleTweetIds, type RunRow } from "../../pipeline/orchestration/retryableFailures";

const SAMPLE_PER_SOURCE = 1000;
const client = getSupabaseClient();
const logger = new SupabaseLogger();

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const out = await fn();
  console.log(`${label}: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return out;
}

async function oldKnown(): Promise<Set<string>> {
  const rows = await fetchAllRows<{ tweet_id: string }>(() => client.from("tweets").select("tweet_id"), "tweet_id");
  const known = new Set(rows.map((r) => r.tweet_id));
  const since = new Date(Date.now() - RETRY_WINDOW_HOURS * 3_600_000).toISOString();
  const runs = await fetchAllRows<RunRow & { id: string }>(
    () => client.from("pipeline_runs").select("id, tweet_id, outcome, outcome_reason, created_at").gte("created_at", since),
    "id",
  );
  for (const id of retryEligibleTweetIds(runs)) known.delete(id);
  return known;
}

async function oldCooldown(): Promise<Set<string>> {
  const notes = await fetchAllRows<{ note_id: string; tweet_id: string }>(() => client.from("notes").select("note_id, tweet_id"), "note_id");
  const out = new Set(notes.map((r) => r.tweet_id).filter(Boolean));
  const rejected = await fetchAllRows<{ id: string; tweet_id: string; created_at: string }>(
    () => client.from("pipeline_runs").select("id, tweet_id, created_at").eq("outcome", "rejected"),
    "id",
  );
  const info = new Map<string, { count: number; latest: number }>();
  for (const r of rejected) {
    if (!r.tweet_id) continue;
    const e = info.get(r.tweet_id) ?? { count: 0, latest: 0 };
    e.count++;
    e.latest = Math.max(e.latest, Date.parse(r.created_at));
    info.set(r.tweet_id, e);
  }
  for (const [id, { count, latest }] of info) {
    if (count >= 3 || Date.now() - latest < (count === 1 ? 1 : 24) * 3_600_000) out.add(id);
  }
  return out;
}

async function sampleIds(): Promise<string[]> {
  const pick = async (table: string, column: string, order: string) => {
    const { data, error } = await client.from(table).select(column).order(order, { ascending: false }).limit(SAMPLE_PER_SOURCE);
    if (error) throw error;
    return (data as unknown as Record<string, string>[]).map((r) => r[column]).filter(Boolean);
  };
  // Recent feed posts are what a run actually asks about. The other sources make
  // sure the sample holds known, noted, rejected and retried tweets.
  const sources = await Promise.all([
    pick("feed_tweets", "tweet_id", "first_seen_at"),
    pick("tweets", "tweet_id", "first_seen_at"),
    pick("notes", "tweet_id", "note_id"),
    pick("pipeline_runs", "tweet_id", "created_at"),
  ]);
  return [...new Set(sources.flat())];
}

function compare(label: string, oldSet: Set<string>, newSet: Set<string>, sample: string[]) {
  const expected = new Set(sample.filter((id) => oldSet.has(id)));
  const missing = [...expected].filter((id) => !newSet.has(id));
  const extra = [...newSet].filter((id) => !expected.has(id));
  console.log(`${label}: ${expected.size} of ${sample.length} sampled ids match. Missing in new: ${missing.length}. Extra in new: ${extra.length}.`);
  if (missing.length) console.log("  missing:", missing.slice(0, 10));
  if (extra.length) console.log("  extra:", extra.slice(0, 10));
}

const sample = await sampleIds();
const [oldK, oldC] = await timed("old full scans", () => Promise.all([oldKnown(), oldCooldown()]));
console.log(`old known set: ${oldK.size} ids, old cooldown set: ${oldC.size} ids`);
const [newK, newC] = await timed(`new lookups for ${sample.length} ids`, () =>
  Promise.all([logger.getKnownTweetIds(sample), logger.getCooldownTweetIds(sample)]),
);
compare("known", oldK, newK, sample);
compare("cooldown", oldC, newC, sample);
