/**
 * Shared pipeline runner for tryoutNotes and runOnVideos.
 *
 * Each script provides a PostFetcher (how to get a Post from a URL) and
 * delegates the processing loop, output, AI judge, and summary to this module.
 */

import { SupabaseLogger } from "../api/supabaseClient";
import { getBotById, getEnabledBots } from "../bots/index";
import { processSingleTweet } from "../pipeline/orchestration/processTweet";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { withBotConfig } from "../pipeline/ab-testing/botConfig";
import { withCostTracker } from "../pipeline/cost-tracking/costTracker";
import { runABTests, withForcedPicks } from "../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../pipeline/ab-testing/abTestsData";
import { createTweetLog, getLoggedBotId, nestDotKeys, withTweetLog } from "../pipeline/utils/tweetLog";
import type { Post } from "../api/fetchEligiblePosts";
import * as fs from "fs";
import * as path from "path";
import PQueue from "p-queue";
import { parseCsvRecords } from "../utils/csv";
import { buildRunName, initOutputFolder, resultToCsvRow, errorToCsvRow } from "./outputWriter";
import { autoOpenInDashboard } from "./dashboardAutoOpen";
import {
  categorizeRow,
  writeResultJsons,
  CATEGORY_RESULT_LABEL,
  type CsvRow,
  type CategorizedRow,
  type Category,
  type BucketCounts,
} from "./evaluateResults";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InputRow {
  url: string;
  needsNote?: string;
  groundTruthNote?: string;
  judgeGuidance?: string;
  originalNoteText?: string;
  failureReason?: string;
}

export type PostFetcher = (input: InputRow) => Promise<{ post: Post; title: string }>;

interface CompletedResult {
  idx: number;
  url: string;
  title: string;
  outcome: string;
  outcomeReason?: string;
  noteText?: string;
  categorized?: CategorizedRow;
}

// ---------------------------------------------------------------------------
// CSV parsing (input)
// ---------------------------------------------------------------------------

export function parseInputCsv(filePath: string): InputRow[] {
  const content = fs.readFileSync(filePath, "utf8").trim();
  const records = parseCsvRecords(content);

  if (records.length < 2) {
    console.error("CSV must have a header row and at least one data row");
    process.exit(1);
  }

  const header = records[0]!.map((h) => h.trim().toLowerCase());
  const urlIdx = header.indexOf("url");
  if (urlIdx === -1) {
    console.error('CSV must have a "url" column');
    process.exit(1);
  }

  const needsNoteIdx = header.indexOf("needs_note");
  const groundTruthIdx = header.indexOf("ground_truth_note");
  const judgeGuidanceIdx = header.indexOf("judge_guidance");
  const originalNoteIdx = header.indexOf("original_note_text");
  const failureReasonIdx = header.indexOf("failure_reason");

  const rows: InputRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i]!;
    const url = fields[urlIdx]?.trim();
    if (!url) continue;

    rows.push({
      url,
      needsNote: needsNoteIdx >= 0 ? fields[needsNoteIdx]?.trim() : undefined,
      groundTruthNote: groundTruthIdx >= 0 ? fields[groundTruthIdx]?.trim() : undefined,
      judgeGuidance: judgeGuidanceIdx >= 0 ? fields[judgeGuidanceIdx]?.trim() : undefined,
      originalNoteText: originalNoteIdx >= 0 ? fields[originalNoteIdx]?.trim() : undefined,
      failureReason: failureReasonIdx >= 0 ? fields[failureReasonIdx]?.trim() : undefined,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

export interface ParsedCliArgs {
  inputs: InputRow[];
  /** Forced A/B test picks (e.g. `{ bot: "simple-bot", simple_bot_search: "grok43-native" }`). */
  forcedPicks: Record<string, string>;
  datasetName: string;
  reversed: boolean;
  concurrency?: number;
  runName?: string;
}

function takeFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  args.splice(idx, 2);
  return value;
}

function takeAllFlagValues(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; ) {
    if (args[i] !== flag) { i++; continue; }
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      console.error(`${flag} requires a value`);
      process.exit(1);
    }
    out.push(value);
    args.splice(i, 2);
  }
  return out;
}

export function parseCliArgs(
  scriptName: string,
  opts?: { transformArg?: (arg: string) => string }
): ParsedCliArgs {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(`Usage: bun run src/local/${scriptName}.ts [flags] <input.csv | url...>`);
    console.error("  --pick test=variant     force an A/B test variant (repeatable). Use --pick bot=<id> to force the bot.");
    console.error("  --max <n>               limit number of inputs");
    console.error("  --reversed              process newest-last");
    console.error("  --concurrency <n>       parallel workers (default 5)");
    console.error("  --name <label>          name for dashboard upload (default: derived)");
    console.error("\nAvailable bots:", getEnabledBots().map((b) => b.id).join(", "));
    process.exit(1);
  }

  const forcedPicks: Record<string, string> = {};
  for (const pick of takeAllFlagValues(args, "--pick")) {
    const eq = pick.indexOf("=");
    if (eq < 1 || eq === pick.length - 1) {
      console.error(`--pick value must be test=variant (got "${pick}")`);
      process.exit(1);
    }
    forcedPicks[pick.slice(0, eq)] = pick.slice(eq + 1);
  }
  if (forcedPicks.bot && !getBotById(forcedPicks.bot)) {
    console.error(`Unknown bot: ${forcedPicks.bot}`);
    console.error("Available bots:", getEnabledBots().map((b) => b.id).join(", "));
    process.exit(1);
  }

  let maxInputs: number | undefined;
  const maxVal = takeFlagValue(args, "--max");
  if (maxVal !== undefined) {
    maxInputs = parseInt(maxVal, 10);
    if (!maxInputs || maxInputs < 1) {
      console.error("--max requires a positive number");
      process.exit(1);
    }
  }

  let concurrency: number | undefined;
  const concVal = takeFlagValue(args, "--concurrency");
  if (concVal !== undefined) {
    concurrency = parseInt(concVal, 10);
    if (!concurrency || concurrency < 1) {
      console.error("--concurrency requires a positive number");
      process.exit(1);
    }
  }

  const runName = takeFlagValue(args, "--name");

  let reversed = false;
  const reversedFlagIdx = args.indexOf("--reversed");
  if (reversedFlagIdx !== -1) {
    reversed = true;
    args.splice(reversedFlagIdx, 1);
  }

  // Apply per-script arg transformation (e.g. bare tweet IDs → URLs)
  const transformed = opts?.transformArg ? args.map(opts.transformArg) : args;

  const isUrls = transformed.every((a) => a.startsWith("http://") || a.startsWith("https://"));
  let inputs: InputRow[];
  let datasetName: string;

  if (isUrls) {
    inputs = transformed.map((url) => ({ url }));
    datasetName = "urls";
  } else if (transformed.length === 1 && fs.existsSync(transformed[0]!)) {
    inputs = parseInputCsv(transformed[0]!);
    datasetName = path.basename(transformed[0]!, path.extname(transformed[0]!));
  } else {
    console.error(`File not found or invalid args: ${transformed[0]}`);
    process.exit(1);
  }

  if (maxInputs) inputs = inputs.slice(0, maxInputs);

  return { inputs, forcedPicks, datasetName, reversed, concurrency, runName };
}


// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<Category, { emoji: string; label: string }> = {
  note_worthy_correct: { emoji: "✅", label: "correct" },
  note_worthy_incorrect: { emoji: "❌", label: "incorrect" },
  note_worthy_not_proposed: { emoji: "❌", label: "missed" },
  non_note_worthy_correct: { emoji: "✅", label: "correct" },
  non_note_worthy_incorrect: { emoji: "❌", label: "false positive" },
  uncategorized: { emoji: "❓", label: "uncategorized" },
};

function formatResult(r: CompletedResult, count: number, total: number): string {
  const reason = r.outcomeReason ? ` (${r.outcomeReason})` : "";
  const lines: string[] = [];

  if (r.categorized) {
    const { emoji, label } = CATEGORY_LABELS[r.categorized.category];
    lines.push(`--- ${count}/${total} ---`);
    lines.push(`${emoji} (${label}) | ${r.outcome}${reason}`);
  } else {
    lines.push(`--- ${count}/${total} ---`);
    lines.push(`${r.outcome}${reason}`);
  }

  lines.push(`  ${r.url}`);
  lines.push(`  ${r.title}`);
  if (r.noteText) {
    lines.push(`  note: ${r.noteText.slice(0, 120)}`);
  }
  return lines.join("\n");
}

function fmtRate(count: number, total: number): string {
  if (total === 0) return "—";
  return `${count}/${total} (${((count / total) * 100).toFixed(0)}%)`;
}

function printSummary(counts: BucketCounts, totalProcessed: number, errors: number, outputPath: string) {
  const nwTotal = counts.note_worthy_correct + counts.note_worthy_incorrect + counts.note_worthy_not_proposed;
  const nnwTotal = counts.non_note_worthy_correct + counts.non_note_worthy_incorrect;
  const scoredTotal = nwTotal + nnwTotal;
  const overallCorrect = counts.note_worthy_correct + counts.non_note_worthy_correct;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULTS: ${totalProcessed} processed, ${errors} errors`);
  console.log(`Output: ${outputPath}`);

  if (nwTotal > 0) {
    console.log(`\n  NOTEWORTHY (ground truth = yes): ${nwTotal} tweets`);
    console.log(`    correct:      ${fmtRate(counts.note_worthy_correct, nwTotal).padEnd(16)} AI judge confirmed note is good`);
    console.log(`    incorrect:    ${fmtRate(counts.note_worthy_incorrect, nwTotal).padEnd(16)} note proposed but wrong`);
    console.log(`    not proposed: ${fmtRate(counts.note_worthy_not_proposed, nwTotal).padEnd(16)} missed entirely`);
  }

  if (nnwTotal > 0) {
    console.log(`\n  NON-NOTEWORTHY (ground truth = no): ${nnwTotal} tweets`);
    console.log(`    correct:      ${fmtRate(counts.non_note_worthy_correct, nnwTotal).padEnd(16)} correctly no note`);
    console.log(`    incorrect:    ${fmtRate(counts.non_note_worthy_incorrect, nnwTotal).padEnd(16)} false positive`);
  }

  if (scoredTotal > 0) {
    console.log(`\n  OVERALL: ${fmtRate(overallCorrect, scoredTotal)}`);
  }
  if (counts.uncategorized > 0) {
    console.log(`  NO GROUND TRUTH: ${counts.uncategorized} uncategorized`);
  }
  console.log("=".repeat(60));
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export interface RunPipelineOptions {
  scriptName: string;
  folderPrefix: string;
  inputs: InputRow[];
  fetchPost: PostFetcher;
  /** Forced A/B test picks. May include a `bot` key to force a specific bot. */
  forcedPicks?: Record<string, string>;
  datasetName?: string;
  concurrency?: number;
  reversed?: boolean;
  runName?: string;
  cleanup?: () => Promise<void>;
}

export async function runPipeline(options: RunPipelineOptions): Promise<void> {
  const {
    scriptName,
    folderPrefix,
    inputs,
    fetchPost,
    forcedPicks = {},
    datasetName,
    concurrency = 5,
    reversed = false,
    runName,
    cleanup,
  } = options;
  const forcedBotId = forcedPicks.bot;

  let logger: SupabaseLogger | null = null;
  try {
    logger = new SupabaseLogger();
    console.log(`[${scriptName}] Connected to Supabase at ${process.env.SUPABASE_URL}`);
  } catch {
    console.log(`[${scriptName}] No Supabase configured — running without DB logging`);
  }

  console.log(`[${scriptName}] Processing ${inputs.length} item(s)`);

  const output = initOutputFolder(folderPrefix, datasetName, forcedBotId, runName);
  console.log(`[${scriptName}] Output folder: ${output.folderPath}`);

  const results: CompletedResult[] = [];
  const categorizedRows: CategorizedRow[] = [];
  let completedCount = 0;
  let errorCount = 0;

  // Per-task timeout: without this, one hung tweet (e.g. a stuck SearXNG
  // tool-call loop) blocks queue.onIdle() forever and we never reach the
  // dashboard upload step. 5 min is well above legitimate runs and short
  // enough that hangs surface fast.
  const PER_TWEET_TIMEOUT_MS = 5 * 60 * 1000;
  const queue = new PQueue({ concurrency, timeout: PER_TWEET_TIMEOUT_MS, throwOnTimeout: true });

  const uploadLabel = runName ?? buildRunName(folderPrefix, datasetName, forcedBotId);
  let uploaded = false;
  const uploadResults = async () => {
    if (uploaded) return;
    uploaded = true;
    try { await autoOpenInDashboard(output.csvPath, uploadLabel); } catch (err: any) {
      console.error(`[${scriptName}] dashboard upload failed: ${err?.message}`);
    }
  };

  // If the user kills the process (Ctrl-C / SIGTERM), still upload what's
  // already in the CSV so the dashboard reflects partial progress.
  const onSignal = (sig: string) => {
    console.log(`\n[${scriptName}] received ${sig} — uploading partial results before exit...`);
    uploadResults().finally(() => process.exit(130));
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  const orderedInputs = reversed ? [...inputs].reverse() : inputs;
  for (const [i, input] of orderedInputs.entries()) {
    const idx = reversed ? inputs.length - 1 - i : i;
    queue.add(async () => {
      const completed: CompletedResult = {
        idx,
        url: input.url,
        title: "",
        outcome: "error",
      };

      let csvRowData: CsvRow | null = null;

      try {
        const { post, title } = await fetchPost(input);
        completed.title = title;

        const { config, picks } = withForcedPicks(forcedPicks, () => runABTests(AB_TESTS));
        const bot = getBotById(config.botId);
        if (!bot) throw new Error(`No bot registered for id "${config.botId}"`);

        const log = createTweetLog();
        log.set("tweet.index", idx + 1);
        log.set("tweet.total", inputs.length);
        const result = await withTweetLog(log, () =>
          withBotConfig(config, () =>
            withCostTracker(() => {
              log.set("bot.id", config.botId);
              log.set("bot.picks", picks);
              log.set("bot.config", config);
              return processSingleTweet({ post, bot, logger });
            }),
          ),
        );

        completed.outcome = result.outcome;
        completed.outcomeReason = result.outcomeReason;
        completed.noteText = result.noteText;

        const loggedBotId = getLoggedBotId(bot.id, log);

        csvRowData = {
          url: input.url,
          text: result.pipelineResult?.post?.text ?? "",
          needs_note: input.needsNote ?? "",
          ground_truth_note: input.groundTruthNote ?? "",
          judge_guidance: input.judgeGuidance ?? "",
          original_note_text: input.originalNoteText ?? "",
          failure_reason: input.failureReason ?? "",
          bot_id: loggedBotId,
          note_status: result.noteStatus ?? "",
          outcome: `${result.outcome}${result.outcomeReason ? ` (${result.outcomeReason})` : ""}`,
          note_text: result.noteText ?? "",
          logs: log ? JSON.stringify(nestDotKeys(Object.fromEntries(log))) : "",
        };

        // Categorize before writing CSV so we have the result label
        let resultLabel = "";
        try {
          const categorized = await categorizeRow(csvRowData);
          completed.categorized = categorized;
          categorizedRows.push(categorized);
          resultLabel = CATEGORY_RESULT_LABEL[categorized.category];
        } catch (err: any) {
          console.error(`[${scriptName}] Judge failed for ${input.url}: ${err?.message}`);
        }

        output.appendRow(resultToCsvRow(input, loggedBotId, result, resultLabel, log));
      } catch (err: any) {
        console.error(`[${scriptName}] ERROR ${input.url}: ${err?.message}`);
        output.appendRow(errorToCsvRow(input.url, err?.message ?? "unknown"));
        errorCount++;
      }

      completedCount++;
      results.push(completed);
      console.log(`\n${formatResult(completed, completedCount, inputs.length)}`);
    });
  }

  await queue.onIdle();

  const counts = writeResultJsons(categorizedRows, output.folderPath);
  printSummary(counts, inputs.length, errorCount, output.folderPath);

  if (cleanup) {
    try { await cleanup(); } catch {}
  }

  try { await closeBrowser(); } catch {}

  await uploadResults();
}
