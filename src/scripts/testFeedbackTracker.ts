import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";
import { getSupabaseClient } from "../api/supabaseClient";

/**
 * Test script for the feedback tracker
 *
 * Usage: bun run src/scripts/testFeedbackTracker.ts [--cleanup]
 *
 * This script:
 * 1. Inserts test notes using real note IDs from your submission logs
 * 2. Runs the feedback update (you can run update-feedback after this)
 * 3. Optionally cleans up test data with --cleanup flag
 */

// Real note IDs from your submission logs
const TEST_NOTES = [
  { note_id: "2008269868483915872", tweet_id: "2008232870847148309", note_text: "Test note 1" },
  { note_id: "2008279601672581426", tweet_id: "2008165817519620126", note_text: "Test note 2" },
  { note_id: "2008284779855442286", tweet_id: "2008197919628046586", note_text: "Test note 3" },
];

async function insertTestData() {
  console.log("[test] Inserting test notes...");

  const supabase = new SupabaseLogger();

  // Get or create a test bot config
  const botConfig = await supabase.getOrCreateBotConfig("test-bot", "Test bot for feedback tracker");
  console.log(`[test] Using bot config: ${botConfig.name} (${botConfig.id})`);

  for (const note of TEST_NOTES) {
    try {
      await supabase.logNoteSubmission({
        note_id: note.note_id,
        tweet_id: note.tweet_id,
        bot_config_id: botConfig.id,
        note_text: note.note_text,
        evaluation_score: 0.5,
      });
      console.log(`[test] Inserted note: ${note.note_id}`);
    } catch (err: any) {
      // Ignore duplicate key errors
      if (err.code === "23505") {
        console.log(`[test] Note ${note.note_id} already exists, skipping`);
      } else {
        throw err;
      }
    }
  }

  console.log("[test] Done inserting test notes");
  console.log("\n[test] Now run: bun run update-feedback");
}

async function cleanup() {
  console.log("[test] Cleaning up test data...");

  const client = getSupabaseClient();

  // Delete test notes
  for (const note of TEST_NOTES) {
    const { error } = await client
      .from("notes")
      .delete()
      .eq("note_id", note.note_id);

    if (error) {
      console.error(`[test] Failed to delete note ${note.note_id}:`, error);
    } else {
      console.log(`[test] Deleted note: ${note.note_id}`);
    }
  }

  // Delete status history for test notes
  for (const note of TEST_NOTES) {
    await client
      .from("note_status_history")
      .delete()
      .eq("note_id", note.note_id);
  }

  // Delete test bot config
  await client
    .from("bot_configs")
    .delete()
    .eq("name", "test-bot");

  console.log("[test] Cleanup complete");
}

async function showNotes() {
  console.log("[test] Current notes in database:\n");

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("notes")
    .select("note_id, tweet_id, cn_status, submitted_at, last_checked_at")
    .order("submitted_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[test] Error fetching notes:", error);
    return;
  }

  if (!data || data.length === 0) {
    console.log("[test] No notes found");
    return;
  }

  console.table(data);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--cleanup")) {
    await cleanup();
  } else if (args.includes("--show")) {
    await showNotes();
  } else {
    await insertTestData();
    await showNotes();
  }
}

main().catch(console.error);
