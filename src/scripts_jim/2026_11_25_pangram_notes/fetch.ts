/**
 * Fetches every note the Pangram pre-pass submitted to X (GOO-880), with the
 * tweet it was on and its ratings, and writes them as JSON to the path given as
 * the first argument. The file holds tweet texts, so keep it out of the repo.
 *
 *   bun run src/scripts_jim/2026_11_25_pangram_notes/fetch.ts <out.json>
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: runs, error } = await db
  .from("pipeline_runs")
  .select("id, tweet_id, note_id, outcome, outcome_reason, created_at, ab_test_picks")
  .eq("bot_name", "pangram-monitoring")
  .order("created_at");
if (error) throw error;
console.log(`${runs.length} pangram runs`);

const tweetIds = [...new Set(runs.map((r) => r.tweet_id))];
const noteIds = runs.map((r) => r.note_id).filter(Boolean);

const { data: tweets, error: tErr } = await db
  .from("tweets")
  .select("tweet_id, text, author_handle, author_name, posted_at, referenced_tweet_data")
  .in("tweet_id", tweetIds);
if (tErr) throw tErr;
const { data: notes, error: nErr } = await db
  .from("notes")
  .select("note_id, tweet_id, note_text, cn_status, view_count, submitted_at")
  .in("note_id", noteIds);
if (nErr) throw nErr;
const { data: ratings, error: rErr } = await db
  .from("note_ratings_from_public_dump")
  .select("*")
  .in("note_id", noteIds);
if (rErr) throw rErr;
const { data: sightings, error: sErr } = await db.from("pangram_monitoring_sightings").select("*");
if (sErr) throw sErr;

const byTweet = new Map(tweets.map((t) => [t.tweet_id, t]));
const byNote = new Map(notes.map((n) => [n.note_id, n]));
const ratingByNote = new Map(ratings.map((r) => [r.note_id, r]));
const sightingByTweet = new Map(sightings.map((s) => [s.tweet_id, s]));

const rows = runs.map((r) => ({
  run: r,
  tweet: byTweet.get(r.tweet_id),
  note: r.note_id ? byNote.get(r.note_id) : null,
  rating: r.note_id ? ratingByNote.get(r.note_id) : null,
  sighting: sightingByTweet.get(r.tweet_id),
}));
const outPath = process.argv[2];
if (!outPath) throw new Error("Give the output path as the first argument");
writeFileSync(outPath, JSON.stringify(rows, null, 2));
const statusCounts: Record<string, number> = {};
for (const row of rows) {
  const s = row.note?.cn_status ?? `no note (${row.run.outcome})`;
  statusCounts[s] = (statusCounts[s] ?? 0) + 1;
}
console.log(statusCounts, `sightings: ${sightings.length}`);
