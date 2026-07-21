/**
 * Preview for the regular-feed topic-curation PR (read-only DB; one paid
 * selection-LLM call on a sample).
 *
 * Question: if the regular pass had been running curated-topic matching, how
 * many posts/day would stage 1 (keyword) match, and what fraction would the
 * stage-2 judge confirm? Feeds the PR body: expected confirmed/day and
 * priority-slot pressure per run.
 *
 * Universe: tweets-table rows first seen since 7/16 (i.e. posts the regular
 * pipeline actually pooled) that are NOT already topic sightings. Stage 1 is
 * the live predicate on tweet text; stage 2 judges a sample via the real
 * selectPostsNeedingNote (no DB writes — sightings are untouched).
 *
 *   bun run src/scripts_rob/2026_07_21_small_feed_preview/run.ts [--sample 50]
 */

import { SupabaseLogger, getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../api/paging";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { selectPostsNeedingNote } from "../../pipeline/misinfo-monitoring/selectPostsNeedingNote";
import type { Post } from "../../api/fetchEligiblePosts";

const SINCE = "2026-07-16";
const RUNS_PER_DAY = 48; // 30-min cadence
const sampleIdx = process.argv.indexOf("--sample");
const SAMPLE = sampleIdx !== -1 ? Number(process.argv[sampleIdx + 1]) : 50;

const topic = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!;
const logger = new SupabaseLogger();

const sightings = await logger.fetchAllRows<{ id: number; tweet_id: string }>(
  (c) => c.from("misinfo_monitoring_sightings").select("id, tweet_id").eq("topic_id", topic.id),
  "id", "sightings");
const sighted = new Set(sightings.map((s) => s.tweet_id));

// A first_seen_at filter has no index and trips the statement timeout, so
// range-scan the PK instead: snowflake tweet_ids are time-ordered, and all
// current ids are 19 digits, so text comparison == numeric. Start just before
// 7/16 (posted) and filter first_seen in JS. Caveat: excludes OLD posts first
// seen recently — a slight undercount, fine for a preview.
const ID_FLOOR = "2077000000000000000"; // ≈ posted 2026-07-13
const rawTweets = await fetchAllRows<{ tweet_id: string; text: string | null; first_seen_at: string | null; posted_at: string | null; impressions: number | null }>(
  () => getSupabaseClient().from("tweets").select("tweet_id, text, first_seen_at, posted_at, impressions").gt("tweet_id", ID_FLOOR),
  "tweet_id", { label: "recent tweets by id range", pageSize: 500 });
const tweets = rawTweets.filter((t) => (t.first_seen_at ?? "") >= SINCE);

const days = new Set(tweets.map((t) => (t.first_seen_at ?? "").slice(0, 10))).size;
const pooled = tweets.filter((t) => !sighted.has(t.tweet_id) && t.text);
const matched = pooled.filter((t) => topic.matches(t.text!.toLowerCase()));
console.log(`\n[preview] ${tweets.length} pooled tweets over ${days} day(s); ${pooled.length} never topic-sighted; ` +
  `stage-1 matches: ${matched.length} (${(matched.length / days).toFixed(1)}/day)`);

// Stage 2 on a spread sample (every k-th by first_seen order → covers the window).
const sorted = [...matched].sort((a, b) => (a.first_seen_at ?? "").localeCompare(b.first_seen_at ?? ""));
const step = Math.max(1, Math.floor(sorted.length / SAMPLE));
const sample = sorted.filter((_, i) => i % step === 0).slice(0, SAMPLE);
const posts: Post[] = sample.map((t) => ({
  id: t.tweet_id,
  author_id: "",
  created_at: t.posted_at ?? new Date().toISOString(),
  text: t.text!,
  media: [],
}));

console.log(`[preview] judging ${posts.length} of ${matched.length} matches with the real selection LLM...`);
const selected = await selectPostsNeedingNote(topic, posts);
const rate = selected.length / posts.length;
console.log(`\n[preview] judge confirmed ${selected.length}/${posts.length} (${(100 * rate).toFixed(0)}%)`);
console.log(`[preview] → expected confirmed/day ≈ ${(rate * matched.length / days).toFixed(1)}; ` +
  `per 30-min run ≈ ${(rate * matched.length / days / RUNS_PER_DAY).toFixed(2)} (priority slots: 3/run)`);

console.log(`\n[preview] sample of confirmed posts:`);
for (const s of selected.slice(0, 10)) {
  const t = sample.find((x) => x.tweet_id === s.postId)!;
  console.log(`  ${s.postId}  ${(t.text ?? "").replace(/\s+/g, " ").slice(0, 90)}`);
  console.log(`     → ${s.reason.slice(0, 110)}`);
}
