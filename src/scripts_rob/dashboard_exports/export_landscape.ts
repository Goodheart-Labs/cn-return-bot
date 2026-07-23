/**
 * Dashboard export #4 — the landscape (read-only).
 *
 * The additionality case: is anyone ELSE putting context on this topic's
 * posts, and could any writer — human or automated — even reach the posts
 * that do get noted? Three headline blocks, all aggregates (no post content,
 * no note content):
 *
 *  1. attention_by_population — of the topic posts we sighted (XXL feed) and
 *     the topic posts that flowed through the regular small feed untreated,
 *     how many carry ANYONE ELSE's note, how many reached a rating decision,
 *     how many have a note actually displaying. Our own notes are excluded —
 *     this measures the rest of the ecosystem.
 *  2. note_requests — X users can request a note on a post; how often did
 *     anyone request one on our topic posts? (The "nobody is even asking"
 *     stat.)
 *  3. writable_surface — of the tweets the wider ecosystem wrote election
 *     notes on, what fraction ever appeared on ANY surface our pipeline can
 *     see (topic sightings, XXL feed snapshots, hourly capture, any pipeline
 *     feed)? A structural ceiling on any API-feed-based writer.
 *
 * Sources: prod DB + X's public dump copy in --dump-dir (default ./cn-data).
 *
 *   bun run src/scripts_rob/dashboard_exports/export_landscape.ts [--out <file>] [--dump-dir ./cn-data]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { SupabaseLogger, getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../api/paging";
import { forEachTsvRow } from "./tsv";

const TOPIC_ID = "trump_election_security";
const WINDOW_START = Date.parse("2026-06-18T00:00:00Z");
const SPEECH_DAY = "2026-07-16";
const FEED_COVERAGE_START = "2026-07-17"; // feed_tweets snapshots begin here
const SHOWN = "CURRENTLY_RATED_HELPFUL";
const NOT_HELPFUL = "CURRENTLY_RATED_NOT_HELPFUL";
// tweets.first_seen_at is unindexed (statement_timeout); snowflake ids are
// time-ordered, so range-scan the PK and filter in JS. ≈ posted 2026-06-15.
const ID_FLOOR = "2066000000000000000";

const outIdx = process.argv.indexOf("--out");
const OUT = outIdx !== -1 ? process.argv[outIdx + 1]! : `${import.meta.dir}/out/landscape.json`;
const dumpIdx = process.argv.indexOf("--dump-dir");
const DUMP_DIR = dumpIdx !== -1 ? process.argv[dumpIdx + 1]! : "./cn-data";

const topic = MISINFO_TOPICS.find((t) => t.id === TOPIC_ID)!;
const BROAD =
  /\b(election|ballot|voter|voting|electoral|mail-?in|noncitizen|non-?citizen|voting machine|voter roll|registered to vote)\b/i;
const logger = new SupabaseLogger();
const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
const pctNum = (a: number, b: number) => (b ? Number(((100 * a) / b).toFixed(1)) : null);

// ── DB: our surfaces + our own notes (to exclude from "ecosystem") ───────────
const sightings = new Set((await logger.fetchAllRows<{ id: number; tweet_id: string }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id").eq("topic_id", TOPIC_ID),
  "id", "sightings")).map((s) => s.tweet_id));
const ourNoteIds = new Set((await logger.fetchAllRows<{ note_id: string }>(
  (c) => c.from("notes").select("note_id"), "note_id", "our notes")).map((n) => n.note_id));
const feedTweets = new Set((await logger.fetchAllRows<{ tweet_id: string }>(
  (c) => c.from("feed_tweets").select("tweet_id"), "tweet_id", "feed_tweets")).map((t) => t.tweet_id));
const processed = await fetchAllRows<{ tweet_id: string; text: string | null; first_seen_at: string | null }>(
  () => getSupabaseClient().from("tweets").select("tweet_id, text, first_seen_at").gt("tweet_id", ID_FLOOR),
  "tweet_id", { label: "tweets by id range", pageSize: 500 });
const processedIds = new Set(processed.map((t) => t.tweet_id));
const captured = new Set<string>();
for (const line of readFileSync("capture-data/trump-election-fraud.jsonl", "utf8").split("\n").filter(Boolean)) {
  try {
    const j = JSON.parse(line) as { tweet_id?: string; id?: string };
    const id = String(j.tweet_id ?? j.id ?? "");
    if (id) captured.add(id);
  } catch { /* skip malformed capture line */ }
}

// Topic posts that flowed through the REGULAR feed without topic treatment
// (never sighted). Frozen population: since topic curation of the regular feed
// went live (7/21), new matches enter the sighted set instead.
const regularTopicIds = new Set(processed
  .filter((t) => (t.first_seen_at ?? "") >= SPEECH_DAY && !sightings.has(t.tweet_id) &&
    t.text && topic.matches(t.text.toLowerCase()))
  .map((t) => t.tweet_id));
console.error(`[landscape] populations: ${sightings.size} sighted, ${regularTopicIds.size} regular-feed topic posts`);

// ── DB: note requests on topic posts ─────────────────────────────────────────
// raw_tweet (with note_request_suggestions) is stored for pipeline-processed
// posts since 2026-06-16; denominator = topic posts where that data exists.
// A null field means no requests were present when we captured the post —
// the denominator is every topic post the pipeline processed (raw post data
// is stored for processed posts since 2026-06-16; all topic posts qualify).
const topicIdsInTweets = [...new Set([...sightings, ...regularTopicIds])].filter((id) => processedIds.has(id));
let requestsChecked = 0, requestsAny = 0, requestsTotal = 0;
for (const ids of chunk(topicIdsInTweets, 100)) {
  for (const r of await logger.fetchAllRows<{ tweet_id: string; nrs: unknown }>(
    (c) => c.from("tweets").select("tweet_id, nrs:raw_tweet->note_request_suggestions").in("tweet_id", ids),
    "tweet_id")) {
    requestsChecked++;
    const n = Array.isArray(r.nrs) ? r.nrs.length : 0;
    if (n > 0) { requestsAny++; requestsTotal += n; }
  }
}
console.error(`[landscape] note requests: ${requestsAny}/${requestsChecked} topic posts have any (${requestsTotal} total)`);

// ── Dump pass 1: notes (ecosystem only — ours excluded) ──────────────────────
interface DNote { tweetId: string; tier: "strict" | "broad" | null; status?: string }
const dumpNotes = new Map<string, DNote>();
const notesByTweet = new Map<string, DNote[]>();
const populationIds = new Set([...sightings, ...regularTopicIds]);
await forEachTsvRow(DUMP_DIR, "notes-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const created = Number(cols[i("createdAtMillis")]);
  if (!Number.isFinite(created) || created < WINDOW_START) return;
  if (cols[i("classification")] !== "MISINFORMED_OR_POTENTIALLY_MISLEADING") return;
  const noteId = cols[i("noteId")]!;
  if (ourNoteIds.has(noteId)) return; // ecosystem = not us
  const tweetId = cols[i("tweetId")]!;
  const summary = (cols[i("summary")] ?? "").toLowerCase();
  const tier = topic.matches(summary) ? "strict" : BROAD.test(summary) ? "broad" : null;
  if (!tier && !populationIds.has(tweetId)) return;
  const n: DNote = { tweetId, tier };
  dumpNotes.set(noteId, n);
  if (populationIds.has(tweetId)) {
    const list = notesByTweet.get(tweetId) ?? [];
    list.push(n);
    notesByTweet.set(tweetId, list);
  }
});

// ── Dump pass 2: statuses ────────────────────────────────────────────────────
await forEachTsvRow(DUMP_DIR, "noteStatusHistory-", (cols, h) => {
  const i = (n: string) => h.indexOf(n);
  const note = dumpNotes.get(cols[i("noteId")]!);
  if (note) note.status = cols[i("currentStatus")] ?? "";
});

// ── Block 1: attention by population ─────────────────────────────────────────
function attention(ids: Set<string>) {
  const all = [...ids];
  const noted = all.filter((id) => (notesByTweet.get(id) ?? []).length > 0);
  const decided = all.filter((id) =>
    (notesByTweet.get(id) ?? []).some((n) => n.status === SHOWN || n.status === NOT_HELPFUL));
  const shown = all.filter((id) => (notesByTweet.get(id) ?? []).some((n) => n.status === SHOWN));
  return {
    posts: all.length,
    with_ecosystem_note: noted.length,
    with_ecosystem_note_pct: pctNum(noted.length, all.length),
    note_reached_decision: decided.length,
    note_displaying: shown.length,
  };
}
const xxl = attention(sightings);
const regular = attention(regularTopicIds);

// ── Block 3: writable surface ────────────────────────────────────────────────
function surface(notes: DNote[]) {
  const tweets = [...new Set(notes.map((n) => n.tweetId))];
  const reachable = tweets.filter((t) =>
    sightings.has(t) || feedTweets.has(t) || captured.has(t) || processedIds.has(t));
  return {
    ecosystem_notes: notes.length,
    on_tweets: tweets.length,
    tweets_on_any_surface_we_see: reachable.length,
    reachable_pct: pctNum(reachable.length, tweets.length),
  };
}
const matched = [...dumpNotes.values()].filter((n) => n.tier);
const decidedNotes = matched.filter((n) => n.status === SHOWN || n.status === NOT_HELPFUL);
const writableSurface = {
  caveat: `feed snapshot coverage starts ${FEED_COVERAGE_START}; earlier posts being unseen is unknowable, not evidence`,
  all_election_notes_since_window: surface(matched),
  strict_topic_notes: surface(matched.filter((n) => n.tier === "strict")),
  notes_that_got_rating_attention: surface(decidedNotes),
};

// ── Emit ─────────────────────────────────────────────────────────────────────
const statusFiles = readdirSync(DUMP_DIR).filter((f) => f.startsWith("noteStatusHistory") && f.endsWith(".tsv"));
const out = {
  generated_at: new Date().toISOString(),
  topic: "Curated topic — the July 16, 2026 primetime address",
  window_start: new Date(WINDOW_START).toISOString().slice(0, 10),
  dump_as_of: statusFiles.length ? statSync(`${DUMP_DIR}/${statusFiles[0]}`).mtime.toISOString() : null,
  field_notes: {
    attention_by_population: "ecosystem = notes by anyone EXCEPT this operation; populations are topic posts sighted on the high-reach feed vs topic posts that flowed through the regular feed untreated (population frozen once regular-feed topic curation went live 7/21)",
    note_requests: "X users can request a note on a post; denominator = topic posts our pipeline processed (request data captured with the post, point-in-time). Demand-vs-supply: compare posts_with_any_request against with_ecosystem_note above",
    writable_surface: "of the tweets the ecosystem wrote election notes on, the share that ever appeared on any surface an API-feed-based writer can see — a structural ceiling for any automated writer",
  },
  attention_by_population: {
    high_reach_feed_topic_posts: xxl,
    regular_feed_topic_posts: regular,
    attention_ratio:
      xxl.with_ecosystem_note_pct && regular.with_ecosystem_note_pct
        ? Number((regular.with_ecosystem_note_pct / xxl.with_ecosystem_note_pct).toFixed(1))
        : null,
  },
  note_requests: {
    topic_posts_checked: requestsChecked,
    posts_with_any_request: requestsAny,
    posts_with_any_request_pct: pctNum(requestsAny, requestsChecked),
    total_requests: requestsTotal,
  },
  writable_surface: writableSurface,
};
await Bun.write(OUT, JSON.stringify(out, null, 2));
console.log(`\nlandscape → ${OUT}\n`);
console.log(JSON.stringify({ attention_by_population: out.attention_by_population, note_requests: out.note_requests, writable_surface: writableSurface }, null, 2));
