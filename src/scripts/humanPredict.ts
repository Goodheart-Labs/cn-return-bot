/**
 * Human Prediction Script
 *
 * Interactive CLI for manual helpfulness predictions.
 * Shows recently submitted notes and prompts for a decimal prediction
 * of the coreNoteIntercept score (>0.4 = helpful, <-0.04 = not helpful).
 *
 * Predictions are stored in pipeline_scores as "pred_human" and included
 * in the evaluatePredictors.ts leaderboard alongside automated methods.
 *
 * Usage: bun run src/scripts/humanPredict.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "readline";

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/** Paginate past Supabase's 1000-row default limit */
async function fetchAll<T>(
  buildQuery: () => any
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  // Get submitted pipeline runs that don't yet have a pred_human score (paginated)
  const runs = await fetchAll<{ id: string; tweet_id: string; tweet_text: string; bot_id: string; note_id: string; created_at: string }>(
    () => client
      .from("pipeline_runs")
      .select("id, tweet_id, tweet_text, bot_id, note_id, created_at")
      .eq("outcome", "submitted")
      .not("note_id", "is", null)
      .order("created_at", { ascending: false })
  );

  if (runs.length === 0) {
    console.log("No submitted notes found.");
    process.exit(0);
  }

  // Get existing pred_human scores (batched to avoid URL length limits)
  const runIds = runs.map((r) => r.id);
  const allExistingScores: Array<{ pipeline_run_id: string }> = [];
  const BATCH_SIZE = 200;
  for (let i = 0; i < runIds.length; i += BATCH_SIZE) {
    const batch = runIds.slice(i, i + BATCH_SIZE);
    const { data } = await client
      .from("pipeline_scores")
      .select("pipeline_run_id")
      .eq("score_type", "pred_human")
      .in("pipeline_run_id", batch);
    if (data) allExistingScores.push(...data);
  }

  const alreadyPredicted = new Set(
    allExistingScores.map((s) => s.pipeline_run_id)
  );

  // Get note texts from notes table (batched)
  const noteIds = runs.map((r) => r.note_id).filter(Boolean);
  const allNotes: Array<{ note_id: string; note_text: string; source_url: string }> = [];
  for (let i = 0; i < noteIds.length; i += BATCH_SIZE) {
    const batch = noteIds.slice(i, i + BATCH_SIZE);
    const { data } = await client
      .from("notes")
      .select("note_id, note_text, source_url")
      .in("note_id", batch);
    if (data) allNotes.push(...data);
  }

  const noteMap = new Map(
    allNotes.map((n) => [n.note_id, n])
  );

  // Filter to unpredicted notes
  const unpredicted = runs.filter((r) => !alreadyPredicted.has(r.id));

  if (unpredicted.length === 0) {
    console.log("All submitted notes already have human predictions.");
    process.exit(0);
  }

  console.log(`\n${unpredicted.length} notes need predictions (${alreadyPredicted.size} already done)\n`);
  console.log("Scoring guide: >0.4 = helpful, <-0.04 = not helpful");
  console.log("Enter a decimal, or press Enter to skip, or 'q' to quit.\n");

  let predicted = 0;

  for (const run of unpredicted) {
    const note = noteMap.get(run.note_id);
    const tweetUrl = `https://x.com/i/status/${run.tweet_id}`;

    console.log("─".repeat(60));
    console.log(`Tweet: ${tweetUrl}`);
    console.log(`Tweet text: ${(run.tweet_text || "").slice(0, 300)}`);
    console.log(`Bot: ${run.bot_id}`);
    console.log(`Date: ${run.created_at}`);

    if (note) {
      console.log(`\nNote: ${note.note_text}`);
      console.log(`Source: ${note.source_url || "(none)"}`);
    } else {
      console.log(`\nNote text not found (note_id: ${run.note_id})`);
    }

    console.log();
    const answer = await ask("Your prediction: ");

    if (answer === "q" || answer === "quit") {
      break;
    }

    if (answer === "") {
      console.log("Skipped.\n");
      continue;
    }

    const value = parseFloat(answer);
    if (isNaN(value)) {
      console.log("Invalid number, skipping.\n");
      continue;
    }

    // Store prediction
    const { error } = await client.from("pipeline_scores").insert({
      pipeline_run_id: run.id,
      score_type: "pred_human",
      score_value: value,
    });

    if (error) {
      console.error("Error saving prediction:", error);
    } else {
      predicted++;
      console.log(`Saved: ${value}\n`);
    }
  }

  console.log(`\nDone. ${predicted} predictions saved.`);
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  rl.close();
  process.exit(1);
});
