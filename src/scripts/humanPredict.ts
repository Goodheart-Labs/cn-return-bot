/**
 * Human Prediction CLI
 *
 * Interactive tool for manually predicting coreNoteIntercept scores.
 * Shows each submitted note that doesn't yet have a pred_human score
 * and prompts for your prediction.
 *
 * Usage: bun run src/scripts/humanPredict.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as readline from "readline";

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  // 1. Get all submitted pipeline runs with note_ids
  const { data: runs, error: runsError } = await client
    .from("pipeline_runs")
    .select("id, note_id, tweet_id, created_at")
    .eq("outcome", "submitted")
    .not("note_id", "is", null)
    .order("created_at", { ascending: false });

  if (runsError || !runs) {
    console.error("Error fetching pipeline runs:", runsError);
    process.exit(1);
  }

  // 2. Get existing human predictions
  const { data: existingScores } = await client
    .from("pipeline_scores")
    .select("pipeline_run_id")
    .eq("score_type", "pred_human");

  const alreadyPredicted = new Set(
    (existingScores || []).map((s) => s.pipeline_run_id)
  );

  // 3. Get note texts from the notes table
  const noteIds = runs.map((r) => r.note_id).filter(Boolean);
  const { data: notes } = await client
    .from("notes")
    .select("note_id, tweet_id, note_text, source_url, bot_name")
    .in("note_id", noteIds);

  const noteByNoteId = new Map(
    (notes || []).map((n) => [n.note_id, n])
  );

  // 4. Filter to runs that need predictions
  const needsPrediction = runs.filter((r) => !alreadyPredicted.has(r.id));

  if (needsPrediction.length === 0) {
    console.log("All submitted notes already have human predictions!");
    process.exit(0);
  }

  console.log(`\n${needsPrediction.length} notes need human predictions.`);
  console.log("Enter a decimal prediction (your estimate of coreNoteIntercept).");
  console.log("  > 0.4 = helpful, < -0.04 = not helpful");
  console.log("  Press Enter to skip, 'q' to quit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let predicted = 0;
  let skipped = 0;

  for (let i = 0; i < needsPrediction.length; i++) {
    const run = needsPrediction[i]!;
    const note = noteByNoteId.get(run.note_id);

    console.log(`\n--- Note ${i + 1}/${needsPrediction.length} ---`);
    console.log(`Pipeline run: ${run.id}`);
    console.log(`Note ID: ${run.note_id}`);
    console.log(`Tweet ID: ${run.tweet_id || note?.tweet_id || "unknown"}`);
    if (note?.bot_name) console.log(`Bot: ${note.bot_name}`);
    console.log(`Submitted: ${run.created_at}`);

    if (note?.source_url) {
      console.log(`Source: ${note.source_url}`);
    }

    if (note?.note_text) {
      console.log(`\nNote text:\n${note.note_text}\n`);
    } else {
      console.log("\n(Note text not available)\n");
    }

    const answer = await prompt(rl, "Your prediction (decimal): ");

    if (answer.toLowerCase() === "q") {
      console.log("\nQuitting.");
      break;
    }

    if (answer === "") {
      skipped++;
      continue;
    }

    const value = parseFloat(answer);
    if (isNaN(value)) {
      console.log("Invalid number, skipping.");
      skipped++;
      continue;
    }

    // Store the prediction
    const { error } = await client.from("pipeline_scores").insert({
      pipeline_run_id: run.id,
      score_type: "pred_human",
      score_value: value,
      score_metadata: { source: "humanPredict.ts" },
    });

    if (error) {
      console.error(`Error saving prediction: ${error.message}`);
    } else {
      predicted++;
      console.log(`Saved: ${value}`);
    }
  }

  rl.close();

  console.log(`\nDone! Predicted: ${predicted}, Skipped: ${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
