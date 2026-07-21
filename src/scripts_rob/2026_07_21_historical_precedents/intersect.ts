/**
 * Feed-intersect test: the tweets OTHER contributors wrote election notes on —
 * did any of them ever cross our desk? (read-only)
 *
 * "Cross our desk" = appear in any list of tweets we have ever seen:
 *   1. misinfo_monitoring_sightings — our topic filter's matches (7/18→)
 *   2. feed_tweets — full XXL-feed snapshots (coverage ~7/17–7/18 only)
 *   3. capture JSONL — hourly capture job (7/18→)
 *   4. tweets table — every post any pipeline processed, INCLUDING the regular
 *      small feed (window-restricted)
 *
 * Splits: strict topic-predicate vs broad election regex (matched on NOTE text
 * — a proxy for the tweet's content); decided-either-way subset (reached
 * Helpful OR Not Helpful = got real rating attention). Dates split at 7/17
 * because feed_tweets coverage starts there — "not in feed" before that is
 * unknowable, not evidence.
 *
 * Bonus check (Rob's question): are speech-topic posts arriving through the
 * REGULAR feed and being processed without the topic treatment? = tweets rows
 * since 7/16 whose TEXT matches the topic predicate but were never sighted.
 *
 *   bun run src/scripts_rob/2026_07_21_historical_precedents/intersect.ts
 */

import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { SupabaseLogger } from "../../api/supabaseClient";
import { readdirSync, readFileSync } from "node:fs";

const DATA_DIR = "./cn-data";
const WINDOW_START = Date.parse("2026-06-18T00:00:00Z");
const FEED_COVERAGE_START = "2026-07-17";
const DECIDED = new Set(["CURRENTLY_RATED_HELPFUL", "CURRENTLY_RATED_NOT_HELPFUL"]);

const topic = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!;
const BROAD =
  /\b(election|ballot|voter|voting|electoral|mail-?in|noncitizen|non-?citizen|voting machine|voter roll|registered to vote)\b/i;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");

async function forEachTsvRow(prefix: string, cb: (cols: string[], header: string[]) => void) {
  const paths = readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".tsv")).sort();
  if (!paths.length) throw new Error(`no ${prefix}*.tsv in ${DATA_DIR}`);
  let header: string[] | null = null;
  for (const p of paths) {
    let carry = "";
    const decoder = new TextDecoder();
    const reader = Bun.file(`${DATA_DIR}/${p}`).stream().getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      const text = carry + decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const cols = line.split("\t");
        if (!header) { header = cols; continue; }
        if (cols[0] === header[0]) continue;
        cb(cols, header);
      }
    }
    if (carry && header) cb(carry.split("\t"), header);
  }
}

// ── Dump pass 1: election-matched notes → tweets ─────────────────────────────
interface MNote { tweetId: string; tier: "strict" | "broad"; createdAtMillis: number; decided?: boolean }
const matched = new Map<string, MNote>();
await forEachTsvRow("notes-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const created = Number(cols[i("createdAtMillis")]);
  if (!Number.isFinite(created) || created < WINDOW_START) return;
  if (cols[i("classification")] !== "MISINFORMED_OR_POTENTIALLY_MISLEADING") return;
  const summary = cols[i("summary")] ?? "";
  const tier = topic.matches(summary.toLowerCase()) ? "strict" : BROAD.test(summary) ? "broad" : null;
  if (tier) matched.set(cols[i("noteId")]!, { tweetId: cols[i("tweetId")]!, tier, createdAtMillis: created });
});

// ── Dump pass 2: decided statuses ────────────────────────────────────────────
await forEachTsvRow("noteStatusHistory-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const m = matched.get(cols[i("noteId")]!);
  if (m) m.decided = DECIDED.has(cols[i("currentStatus")] ?? "");
});

// ── Our four "crossed our desk" lists ────────────────────────────────────────
const logger = new SupabaseLogger();
const sightings = new Set((await logger.fetchAllRows<{ id: number; tweet_id: string }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id").eq("topic_id", "trump_election_security"),
  "id", "sightings")).map((s) => s.tweet_id));
const feedTweets = new Set((await logger.fetchAllRows<{ tweet_id: string }>(
  (c) => c.from("feed_tweets").select("tweet_id"), "tweet_id", "feed_tweets")).map((t) => t.tweet_id));
const processed = await logger.fetchAllRows<{ tweet_id: string; text: string | null; first_seen_at: string | null }>(
  (c) => c.from("tweets").select("tweet_id, text, first_seen_at").gte("first_seen_at", "2026-06-15"),
  "tweet_id", "tweets since 6/15");
const processedIds = new Set(processed.map((t) => t.tweet_id));
const captured = new Set<string>();
for (const line of readFileSync("capture-data/trump-election-fraud.jsonl", "utf8").split("\n").filter(Boolean)) {
  captured.add(String((JSON.parse(line) as { tweet_id?: string; id?: string }).tweet_id ?? (JSON.parse(line) as any).id ?? ""));
}

// ── Intersect report ─────────────────────────────────────────────────────────
function report(label: string, notes: MNote[]) {
  const tweets = [...new Set(notes.map((n) => n.tweetId))];
  const inS = tweets.filter((t) => sightings.has(t));
  const inF = tweets.filter((t) => feedTweets.has(t));
  const inC = tweets.filter((t) => captured.has(t));
  const inP = tweets.filter((t) => processedIds.has(t));
  const any = tweets.filter((t) => sightings.has(t) || feedTweets.has(t) || captured.has(t) || processedIds.has(t));
  console.log(`\n${label}: ${notes.length} notes on ${tweets.length} tweets`);
  console.log(`  sighted(topic filter) ${inS.length}  feed_tweets(XXL snapshot) ${inF.length}  capture ${inC.length}  tweets(any pipeline) ${inP.length}  → ANY: ${any.length} (${pct(any.length, tweets.length)})`);
  if (any.length) console.log(`  overlapping tweets: ${any.join(", ")}`);
}

const all = [...matched.values()];
const since = (d: string) => all.filter((m) => m.createdAtMillis >= Date.parse(d));
console.log(`\n== ecosystem election notes since 6/18 vs everything we ever saw ==`);
console.log(`(feed_tweets coverage starts ~${FEED_COVERAGE_START}; "not seen" before that is unknowable, not a miss)`);
report("ALL matched", all);
report("strict tier", all.filter((m) => m.tier === "strict"));
report("decided either way (got rating attention)", all.filter((m) => m.decided));
report(`created ≥ ${FEED_COVERAGE_START} (inside any feed coverage)`, since(FEED_COVERAGE_START));
report(`created ≥ ${FEED_COVERAGE_START}, strict`, since(FEED_COVERAGE_START).filter((m) => m.tier === "strict"));

// ── Bonus: speech-topic posts arriving via the REGULAR feed ──────────────────
const regularTopicish = processed.filter((t) =>
  (t.first_seen_at ?? "") >= "2026-07-16" && !sightings.has(t.tweet_id) && t.text && topic.matches(t.text.toLowerCase()));
console.log(`\n== Rob's question: topic-predicate posts that came through the REGULAR feed (since 7/16, never sighted) ==`);
console.log(`${regularTopicish.length} of ${processed.filter((t) => (t.first_seen_at ?? "") >= "2026-07-16").length} regular-pipeline tweets match the topic predicate on TWEET text`);
for (const t of regularTopicish.slice(0, 15)) {
  console.log(`  ${t.tweet_id}  ${(t.text ?? "").replace(/\s+/g, " ").slice(0, 110)}`);
}
