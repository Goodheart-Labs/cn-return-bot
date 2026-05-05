/**
 * Exercise the submission codepath end-to-end (without hitting the X API):
 * upsertTweet → createPipelineRun → completePipelineRun → logNoteSubmission
 * → markCandidateSubmitted, in the order submitNoteForTweet uses.
 *
 * Specifically verifies that the new FK from migration 035
 * (pipeline_runs.note_id → notes.note_id) doesn't break the submission
 * flow — it depends on logNoteSubmission inserting the note BEFORE
 * markCandidateSubmitted updates pipeline_runs.note_id.
 *
 * Usage:
 *   bun run src/scripts_jim/2026_05_01_backfill_tweets_from_logs/smoke_test_submission.ts
 */

import "dotenv/config";

const url = process.env.LOCAL_SUPABASE_URL;
const key = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("requires LOCAL_SUPABASE_URL / LOCAL_SUPABASE_SERVICE_KEY");
  process.exit(1);
}
process.env.SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_KEY = key;

import { SupabaseLogger } from "../../api/supabaseClient";

const TWEET_ID = `smoke_sub_${Date.now()}`;
const NOTE_ID = `smoke_note_${Date.now()}`;

async function main() {
  const logger = new SupabaseLogger();
  // @ts-expect-error
  const supa = logger["client"];

  console.log(`[smoke-sub] tweet_id=${TWEET_ID} note_id=${NOTE_ID}`);

  // 1. Upsert tweet (as fetchPosts does)
  await logger.bulkInsertNewTweets([{
    id: TWEET_ID,
    author_id: "smoke_author",
    text: "fake tweet",
    media: [],
  }]);

  // 2. Create pipeline_run (as processTweet does)
  const runId = await logger.createPipelineRun({
    tweet_id: TWEET_ID,
    bot_name: "smoke",
    bot_name_long: "smoke_test",
    bot_config: { configName: "test", model: "fake" },
  });
  console.log(`[smoke-sub] pipeline_run id=${runId}`);

  // 3. Complete pipeline_run as candidate (no note_id yet)
  await logger.completePipelineRun(runId, {
    outcome: "candidate",
    final_stage: "candidate",
    bot_name: "smoke",
    bot_name_long: "smoke_test",
    bot_config: { configName: "test", model: "fake" },
    note_text: "fake note text",
    logs: { fake: true },
  });

  // 4. NOW the submission flow — must be in this order:
  //    a) logNoteSubmission → inserts notes row with note_id=NOTE_ID
  //    b) markCandidateSubmitted(runId, NOTE_ID) → sets pipeline_runs.note_id
  //
  // If step (b) ran first, the FK pipeline_runs.note_id → notes.note_id would
  // reject because no notes row exists yet.

  await logger.logNoteSubmission({
    note_id: NOTE_ID,
    tweet_id: TWEET_ID,
    note_text: "fake note text",
    source_url: "https://example.com",
    submitted_at: new Date().toISOString(),
  });
  console.log(`[smoke-sub] logNoteSubmission OK`);

  await logger.markCandidateSubmitted(runId, NOTE_ID);
  console.log(`[smoke-sub] markCandidateSubmitted OK`);

  // 5. Verify the FK actually links the rows
  const { data: pr } = await supa
    .from("pipeline_runs").select("note_id, outcome").eq("id", runId).single();
  if (pr.note_id !== NOTE_ID) throw new Error(`pipeline_runs.note_id mismatch: ${pr.note_id}`);
  if (pr.outcome !== "submitted") throw new Error(`outcome mismatch: ${pr.outcome}`);
  console.log(`[smoke-sub] verified pipeline_runs.note_id=${pr.note_id}, outcome=${pr.outcome}`);

  // 6. Verify the FK by checking that markCandidateSubmitted with a bogus
  //    note_id is rejected by the constraint.
  try {
    await logger.markCandidateSubmitted(runId, "nonexistent_note_id_zzzz");
    throw new Error("FAIL: markCandidateSubmitted with bogus note_id should have errored on FK");
  } catch (e: any) {
    if (!/foreign key|violates|fkey/i.test(e.message)) throw e;
    console.log(`[smoke-sub] FK correctly rejected bogus note_id: ${e.message.slice(0, 80)}...`);
  }

  // Cleanup
  await supa.from("pipeline_runs").delete().eq("id", runId);
  await supa.from("notes").delete().eq("note_id", NOTE_ID);
  await supa.from("tweets").delete().eq("tweet_id", TWEET_ID);
  console.log(`[smoke-sub] cleanup done`);
  console.log(`\n✓ submission flow works end-to-end with the new FK`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
