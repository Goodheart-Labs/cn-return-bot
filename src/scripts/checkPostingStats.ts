import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function fetchAllRows(table: string, select: string) {
  const allRows: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allRows.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}

async function checkPostingStats() {
  // Get ALL pipeline runs
  const runs = await fetchAllRows(
    "pipeline_runs",
    "outcome, outcome_reason, final_stage, note_id, tweet_id, created_at, error_message",
  );

  console.log("=== PIPELINE RUN STATS ===");
  console.log("Total runs:", runs.length);

  // Count by outcome
  const byOutcome: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const byStage: Record<string, number> = {};

  for (const run of runs) {
    byOutcome[run.outcome] = (byOutcome[run.outcome] || 0) + 1;
    if (run.outcome_reason) {
      byReason[run.outcome_reason] = (byReason[run.outcome_reason] || 0) + 1;
    }
    byStage[run.final_stage] = (byStage[run.final_stage] || 0) + 1;
  }

  console.log("\nBy outcome:");
  Object.entries(byOutcome)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log("\nBy outcome reason:");
  Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log("\nBy final stage:");
  Object.entries(byStage)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Check for submitted runs that don't have a note_id
  const submittedNoNote = runs.filter((r) => r.outcome === "submitted" && !r.note_id);
  console.log("\n=== POTENTIAL ISSUES ===");
  console.log("Submitted runs without note_id:", submittedNoNote.length);
  if (submittedNoNote.length > 0) {
    console.log("  Tweet IDs:", submittedNoNote.map((r) => r.tweet_id).join(", "));
  }

  // Check for in_progress runs (started but never completed)
  const inProgress = runs.filter((r) => r.outcome === "in_progress");
  console.log("In-progress (incomplete) runs:", inProgress.length);
  if (inProgress.length > 0) {
    console.log("  Recent in-progress tweets:");
    inProgress.slice(0, 5).forEach((r) => {
      console.log(`    ${r.tweet_id} (stage: ${r.final_stage}, at: ${r.created_at})`);
    });
  }

  // Check notes table
  const { data: notes, error: notesError } = await supabase
    .from("notes")
    .select("note_id, tweet_id, submitted_at")
    .order("submitted_at", { ascending: false });

  if (notesError) {
    console.error("Error fetching notes:", notesError);
    return;
  }

  console.log("\n=== NOTES TABLE ===");
  console.log("Total notes in database:", notes.length);

  // Cross-reference: submitted pipeline runs vs notes
  const submittedRuns = runs.filter((r) => r.outcome === "submitted");
  console.log("Pipeline runs with outcome=submitted:", submittedRuns.length);

  // Check if note counts match
  if (submittedRuns.length !== notes.length) {
    console.log(`⚠️  MISMATCH: submitted runs (${submittedRuns.length}) != notes (${notes.length})`);

    // Find notes that don't have a corresponding pipeline run
    const submittedTweetIds = new Set(submittedRuns.map((r) => r.tweet_id));
    const notesWithoutRun = notes.filter((n) => !submittedTweetIds.has(n.tweet_id));
    if (notesWithoutRun.length > 0) {
      console.log(`  Notes without pipeline run (legacy notes): ${notesWithoutRun.length}`);
    }
  } else {
    console.log("✓ Counts match");
  }

  // Check for failed submissions (outcome=failed at submission stage)
  const failedSubmissions = runs.filter((r) => r.outcome === "failed" && r.final_stage === "submission");
  console.log("\n=== FAILED SUBMISSIONS ===");
  console.log("Failed at submission stage:", failedSubmissions.length);
  if (failedSubmissions.length > 0) {
    console.log("  Recent failures:");
    failedSubmissions.slice(0, 5).forEach((r) => {
      console.log(`    ${r.tweet_id}: ${r.error_message?.slice(0, 100)}`);
    });
  }

  // Check for any errors during bot processing
  const botErrors = runs.filter((r) => r.outcome_reason === "bot_error");
  console.log("\n=== BOT ERRORS ===");
  console.log("Total bot errors:", botErrors.length);

  // Sample error messages
  const uniqueErrors = new Set<string>();
  botErrors.forEach((r) => {
    if (r.error_message) {
      uniqueErrors.add(r.error_message.slice(0, 100));
    }
  });
  if (uniqueErrors.size > 0) {
    console.log("  Unique error patterns:");
    Array.from(uniqueErrors)
      .slice(0, 10)
      .forEach((e) => console.log(`    - ${e}`));
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  const successRate = runs.length > 0 ? ((submittedRuns.length / runs.length) * 100).toFixed(1) : 0;
  console.log(`Submission success rate: ${successRate}% (${submittedRuns.length}/${runs.length})`);

  // Analyze retryability
  console.log("\n=== RETRY ANALYSIS ===");

  // 1. Character limit failures - these are deterministic, won't change on retry
  const charLimitErrors = botErrors.filter((r) => r.error_message?.includes("275 character limit"));
  console.log(`Character limit failures: ${charLimitErrors.length} (NOT retryable - deterministic)`);

  // 2. Check failures - might succeed with different search/framing
  const checkFailed = runs.filter((r) => r.outcome_reason === "check_failed");
  console.log(`Check failures: ${checkFailed.length} (MAYBE retryable - different search might find better source)`);

  // 3. Low evaluation score - might succeed if note is rewritten differently
  const lowEval = runs.filter((r) => r.outcome_reason === "low_evaluation_score");
  console.log(`Low evaluation score: ${lowEval.length} (MAYBE retryable - different phrasing might score better)`);

  // 4. Scoring filter failures - depends on what scores failed
  const scoringFailed = runs.filter((r) => r.outcome_reason === "scoring_filters_failed");
  console.log(`Scoring filter failures: ${scoringFailed.length} (MAYBE retryable)`);

  // 5. No correction needed - this is the bot's judgment, unlikely to change
  const noCorrection = runs.filter((r) => r.outcome_reason === "no_correction_needed");
  console.log(`No correction needed: ${noCorrection.length} (NOT retryable - bot judged post accurate)`);

  // 6. Search failures that aren't char limit
  const searchFailuresOther = botErrors.filter((r) => !r.error_message?.includes("275 character limit"));
  console.log(`Other bot errors: ${searchFailuresOther.length}`);
  if (searchFailuresOther.length > 0) {
    const otherErrors = new Map<string, number>();
    searchFailuresOther.forEach((r) => {
      const msg = r.error_message?.slice(0, 80) || "unknown";
      otherErrors.set(msg, (otherErrors.get(msg) || 0) + 1);
    });
    console.log("  Breakdown:");
    Array.from(otherErrors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([msg, count]) => console.log(`    ${count}x: ${msg}`));
  }

  // Estimate retryable
  const maybeRetryable = checkFailed.length + lowEval.length + scoringFailed.length + searchFailuresOther.length;
  const notRetryable = charLimitErrors.length + noCorrection.length;
  console.log(`\nEstimated retryable: ~${maybeRetryable} (${((maybeRetryable / runs.length) * 100).toFixed(1)}%)`);
  console.log(`Not retryable: ~${notRetryable} (${((notRetryable / runs.length) * 100).toFixed(1)}%)`);
}

checkPostingStats();
