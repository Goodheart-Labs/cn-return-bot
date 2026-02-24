import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// 1. Test notes
const { data: testNotes } = await supabase.from("notes").select("*").or("bot_name.eq.test-bot,note_id.like.test_%");
console.log("=== TEST NOTES IN notes TABLE ===");
console.log(testNotes?.length, "found");
if (testNotes?.length) console.log(JSON.stringify(testNotes, null, 2));

// 2. Failed pipeline runs
const { data: failedRuns } = await supabase.from("pipeline_runs").select("tweet_id, bot_id, outcome, outcome_reason, error_message, created_at").eq("outcome", "failed").order("created_at", { ascending: false }).limit(30);
console.log("\n=== RECENT FAILED PIPELINE RUNS ===");
for (const r of failedRuns || []) {
  console.log(r.created_at?.slice(0,16), r.bot_id, "tweet:", r.tweet_id, r.outcome_reason || "", (r.error_message || "").slice(0, 150));
}

// 3. Duplicate tweets
const { data: allNotes } = await supabase.from("notes").select("note_id, tweet_id, bot_name, submitted_at");
const tweetCounts = new Map<string, number>();
for (const n of allNotes || []) {
  tweetCounts.set(n.tweet_id, (tweetCounts.get(n.tweet_id) || 0) + 1);
}
const dupes = [...tweetCounts.entries()].filter(([_, c]) => c > 1);
console.log("\n=== DUPLICATE TWEET_IDS IN NOTES ===");
console.log(dupes.length, "tweets with multiple notes");
for (const [tid, count] of dupes.slice(0, 10)) {
  const matching = (allNotes || []).filter(n => n.tweet_id === tid);
  console.log("  tweet", tid, ":", count, "notes -", matching.map(n => n.bot_name + " " + n.submitted_at?.slice(0,10)).join(", "));
}

// 4. Test scraped entries
const { data: testScraped } = await supabase.from("canonical_note_information").select("note_id, tweet_id, note_text").like("note_id", "test_%");
console.log("\n=== TEST ENTRIES IN SCRAPED NOTES ===");
console.log(testScraped?.length, "found");
if (testScraped?.length) {
  for (const n of testScraped) {
    console.log("  ", n.note_id, "tweet:", n.tweet_id, "text:", n.note_text?.slice(0, 60));
  }
}

// 5. Notes not found in scraped data
const { data: scraped } = await supabase.from("canonical_note_information").select("note_id");
const scrapedIds = new Set((scraped || []).map(s => s.note_id));
const unscraped = (allNotes || []).filter(n => !scrapedIds.has(n.note_id));
console.log("\n=== NOTES NOT FOUND IN SCRAPED DATA ===");
console.log(unscraped.length, "of", allNotes?.length, "notes have no scraped match");
if (unscraped.length) {
  for (const n of unscraped.slice(0, 10)) {
    console.log("  ", n.note_id, n.bot_name, n.submitted_at?.slice(0, 10));
  }
}

// 6. Placeholder note IDs
const { data: placeholders } = await supabase.from("canonical_note_information").select("note_id, tweet_id").like("note_id", "tweet_%");
console.log("\n=== PLACEHOLDER NOTE IDS (tweet_XXX) ===");
console.log(placeholders?.length, "found");

// 7. Bot coverage
const noteBots = new Set((allNotes || []).map(n => n.bot_name));
const { data: pipelineBots } = await supabase.from("pipeline_runs").select("bot_id");
const pBots = new Set((pipelineBots || []).map(p => p.bot_id));
console.log("\n=== BOT COVERAGE ===");
console.log("Bots in notes table:", [...noteBots].join(", "));
console.log("Bots in pipeline_runs:", [...pBots].join(", "));

// 8. Notes with suspicious data
const { data: allNotesWithText } = await supabase.from("notes").select("note_id, tweet_id, bot_name, note_text, submitted_at").order("submitted_at", { ascending: false });
const suspicious = (allNotesWithText || []).filter(n =>
  !n.note_text || n.note_text.length < 10 || !n.tweet_id || !n.note_id
);
console.log("\n=== NOTES WITH SUSPICIOUS DATA ===");
console.log(suspicious.length, "found");
for (const n of suspicious) {
  console.log("  ", n.note_id, n.bot_name, n.submitted_at?.slice(0,10), "text_len:", n.note_text?.length || 0);
}
