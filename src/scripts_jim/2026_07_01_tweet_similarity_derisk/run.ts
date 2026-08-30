/**
 * Derisking run (small): embed the exact search-step input of 10 tweets from
 * today (the "query set") + 100 tweets from before today (the corpus, including
 * some with community notes), then rank the corpus by embedding similarity to
 * each query tweet.
 *
 * ONLY tweets whose latest logs contain `note_writer_steps.search.messages.0
 * .userMessage` are eligible — no reconstruction, no tweets-row fallback. Tweets
 * without that exact log format are skipped, including during selection.
 *
 * Outputs:
 *   - output/embedded_inputs.json                                → inspect what got embedded per tweet
 *   - ../../review-dashboard/src/generated/similarityResults.json → consumed by the dashboard
 *
 * Run: bun run src/scripts_jim/2026_07_01_tweet_similarity_derisk/run.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { cleanInput, extractInputMessage } from "./embedInput";
import { batchEmbed, cosineSimilarity, EMBED_MODEL, EMBED_DIMS } from "./geminiEmbed";

const N_SOURCES = 10;
const N_CORPUS = 100;
const MIN_NOTE_BEARING = 40; // floor of note-bearing corpus tweets; rest are most-recent
// Over-fetch candidates because only those with a search-step message survive.
const SOURCE_CANDIDATE_LIMIT = 200;
const CORPUS_CANDIDATE_LIMIT = 500;
const NOTE_CANDIDATE_LIMIT = 200;
const NEIGHBORS_PER_SOURCE = 50;
const SEARCH_BATCH = 25; // tweet_ids per pipeline_runs lookup (projects only the search subtree)
const EMBED_BATCH = 100;

const TWEET_COLS = "tweet_id, text, posted_at, first_seen_at";

const SCRIPT_DIR = import.meta.dir;
const OUTPUT_DIR = join(SCRIPT_DIR, "output");
const DASHBOARD_GEN_DIR = join(SCRIPT_DIR, "..", "..", "review-dashboard", "src", "generated");

interface TweetRow {
  tweet_id: string;
  text?: string | null;
  posted_at?: string | null;
  first_seen_at?: string | null;
}

function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  return createClient(url, key);
}

function startOfTodayUtc(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

async function fetchTweetPage(
  client: SupabaseClient,
  apply: (q: any) => any,
): Promise<TweetRow[]> {
  const { data, error } = await apply(client.from("tweets").select(TWEET_COLS));
  if (error) throw error;
  return (data ?? []) as TweetRow[];
}

/** Tweet_ids (before today) that have at least one community note — ours or a competitor's. */
async function noteBearingTweetIds(client: SupabaseClient, today: string): Promise<string[]> {
  const ours = await client
    .from("notes")
    .select("tweet_id, submitted_at")
    .not("tweet_id", "is", null)
    .lt("submitted_at", today)
    .order("submitted_at", { ascending: false })
    .limit(NOTE_CANDIDATE_LIMIT);
  if (ours.error) throw ours.error;
  const competing = await client.from("competing_notes").select("tweet_id").limit(NOTE_CANDIDATE_LIMIT);
  if (competing.error) throw competing.error;
  const ids = [
    ...(ours.data ?? []).map((r: any) => r.tweet_id),
    ...(competing.data ?? []).map((r: any) => r.tweet_id),
  ].filter(Boolean);
  return [...new Set(ids)];
}

async function fetchTweetsByIds(client: SupabaseClient, ids: string[], today: string): Promise<TweetRow[]> {
  const out: TweetRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(
      ...(await fetchTweetPage(client, (q) => q.in("tweet_id", ids.slice(i, i + 100)).lt("first_seen_at", today))),
    );
  }
  return out;
}

/**
 * For each tweet_id, the formatted input message from its most recent run that
 * logged one — the search step, else the prefilter search-analyzer. Projects only
 * those two subtrees (indexed tweet_id IN lookups — no global scan, no full-logs
 * transfer). Tweets with neither are simply absent from the returned map.
 */
async function fetchInputMessages(client: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const byTweet = new Map<string, string>();
  for (let i = 0; i < ids.length; i += SEARCH_BATCH) {
    const batch = ids.slice(i, i + SEARCH_BATCH);
    const { data, error } = await client
      .from("pipeline_runs")
      .select(
        "tweet_id, created_at, search:logs->note_writer_steps->search, prefilter:logs->note_prefilter_steps->search_analyzer",
      )
      .in("tweet_id", batch)
      .order("created_at", { ascending: false });
    if (error) throw error;
    for (const row of (data ?? []) as { tweet_id: string; search: unknown; prefilter: unknown }[]) {
      if (byTweet.has(row.tweet_id)) continue; // desc order → keep the newest run with a message
      const msg = extractInputMessage(row.search, row.prefilter);
      if (msg) byTweet.set(row.tweet_id, msg);
    }
  }
  return byTweet;
}

async function embedAll(byId: Map<string, string>): Promise<Map<string, number[]>> {
  const ids = [...byId.keys()];
  const vectors = new Map<string, number[]>();
  for (let i = 0; i < ids.length; i += EMBED_BATCH) {
    const batchIds = ids.slice(i, i + EMBED_BATCH);
    const vecs = await batchEmbed(batchIds.map((id) => byId.get(id)!));
    batchIds.forEach((id, j) => vectors.set(id, vecs[j]!));
    console.log(`  embedded ${Math.min(i + EMBED_BATCH, ids.length)}/${ids.length}`);
  }
  return vectors;
}

async function main() {
  const client = db();
  const today = startOfTodayUtc();
  console.log(`Today (UTC) boundary: ${today}`);

  // Candidate pools (over-fetched; only those with a search message survive).
  const sourceCandidates = await fetchTweetPage(client, (q) =>
    q.gte("first_seen_at", today).order("first_seen_at", { ascending: false }).limit(SOURCE_CANDIDATE_LIMIT),
  );
  const noteCandidates = await fetchTweetsByIds(client, await noteBearingTweetIds(client, today), today);
  const recentCandidates = await fetchTweetPage(client, (q) =>
    q.lt("first_seen_at", today).order("first_seen_at", { ascending: false }).limit(CORPUS_CANDIDATE_LIMIT),
  );

  const candidateIds = [
    ...new Set([...sourceCandidates, ...noteCandidates, ...recentCandidates].map((t) => t.tweet_id)),
  ];
  console.log(`Candidates: ${sourceCandidates.length} today, ${noteCandidates.length} note-bearing, ${recentCandidates.length} recent (${candidateIds.length} unique)`);

  console.log("Fetching input messages (search step → prefilter search-analyzer)...");
  const inputMsgById = await fetchInputMessages(client, candidateIds);
  console.log(`  ${inputMsgById.size}/${candidateIds.length} candidates have an input message`);

  const hasMsg = (t: TweetRow) => inputMsgById.has(t.tweet_id);

  const sources = sourceCandidates.filter(hasMsg).slice(0, N_SOURCES);
  if (sources.length === 0) throw new Error("No today-tweets with an input message — nothing to query with");
  if (sources.length < N_SOURCES) console.warn(`  only ${sources.length}/${N_SOURCES} today-tweets have an input message`);
  const sourceIds = new Set(sources.map((t) => t.tweet_id));

  // Corpus: a floor of note-bearing tweets (so notes always show), then filled
  // with the most-recent tweets for topical overlap — deduped, sources excluded.
  const noteBearing = new Set(noteCandidates.map((t) => t.tweet_id));
  const corpus: TweetRow[] = [];
  const inCorpus = new Set<string>();
  const addToCorpus = (t: TweetRow) => {
    if (corpus.length >= N_CORPUS || !hasMsg(t) || sourceIds.has(t.tweet_id) || inCorpus.has(t.tweet_id)) return;
    corpus.push(t);
    inCorpus.add(t.tweet_id);
  };
  noteCandidates.filter(hasMsg).slice(0, MIN_NOTE_BEARING).forEach(addToCorpus);
  recentCandidates.forEach(addToCorpus);
  noteCandidates.forEach(addToCorpus); // top up if recent ran short
  const corpusNoteBearing = corpus.filter((t) => noteBearing.has(t.tweet_id)).length;
  console.log(`Sources: ${sources.length} | Corpus: ${corpus.length} — ${corpusNoteBearing} with notes`);

  const allRows = [...sources, ...corpus];
  const textById = new Map<string, string>();
  for (const row of allRows) textById.set(row.tweet_id, cleanInput(inputMsgById.get(row.tweet_id)!));

  console.log(`Embedding ${textById.size} inputs with ${EMBED_MODEL} (${EMBED_DIMS}d)...`);
  const vectors = await embedAll(textById);

  const results = sources.map((src) => {
    const srcVec = vectors.get(src.tweet_id)!;
    const neighbors = corpus
      .map((t) => ({ tweetId: t.tweet_id, similarity: cosineSimilarity(srcVec, vectors.get(t.tweet_id)!) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, NEIGHBORS_PER_SOURCE)
      .map((n) => ({ tweetId: n.tweetId, similarity: Number(n.similarity.toFixed(4)) }));
    return { tweetId: src.tweet_id, text: src.text ?? "", postedAt: src.posted_at ?? null, neighbors };
  });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(DASHBOARD_GEN_DIR, { recursive: true });

  const embeddedInputs = allRows.map((row) => ({
    tweet_id: row.tweet_id,
    role: sourceIds.has(row.tweet_id) ? "source" : "corpus",
    has_note: noteBearing.has(row.tweet_id),
    char_len: textById.get(row.tweet_id)!.length,
    text: textById.get(row.tweet_id)!,
  }));
  writeFileSync(join(OUTPUT_DIR, "embedded_inputs.json"), JSON.stringify(embeddedInputs, null, 2));

  const dashboardPayload = {
    generatedAt: new Date().toISOString(),
    model: EMBED_MODEL,
    dims: EMBED_DIMS,
    corpusSize: corpus.length,
    corpusWithNotes: corpusNoteBearing,
    sources: results,
  };
  writeFileSync(join(DASHBOARD_GEN_DIR, "similarityResults.json"), JSON.stringify(dashboardPayload, null, 2));

  console.log(`\nWrote ${embeddedInputs.length} embedded inputs → ${join(OUTPUT_DIR, "embedded_inputs.json")}`);
  console.log(`Wrote dashboard payload → ${join(DASHBOARD_GEN_DIR, "similarityResults.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
