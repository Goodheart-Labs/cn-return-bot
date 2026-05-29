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
  categorizeRowV2,
  writeResultJsonsV2,
  type CsvRow,
  type CategorizedRowV2,
  type CategoryV2,
  type BucketCountsV2,
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
  categorized?: CategorizedRowV2;
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
    console.error("  --search-cache <dir>    cache/replay SearXNG results to/from this directory");
    console.error("  --input-cache <dir>     cache/replay bot inputs (media, comments, author history)");
    console.error("  --writer-cache <dir>    cache/replay cheap-bot writer output (replay starts from the two judges)");
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

  const searchCache = takeFlagValue(args, "--search-cache");
  if (searchCache) {
    process.env.SEARCH_CACHE = searchCache;
    console.log(`[${scriptName}] Search cache: ${searchCache}`);
  }

  const inputCache = takeFlagValue(args, "--input-cache");
  if (inputCache) {
    process.env.BIG_EVAL_INPUT_CACHE = inputCache;
    console.log(`[${scriptName}] Input cache: ${inputCache}`);
  }

  const writerCache = takeFlagValue(args, "--writer-cache");
  if (writerCache) {
    process.env.CHEAP_BOT_WRITER_CACHE = writerCache;
    console.log(`[${scriptName}] Writer cache: ${writerCache}`);
  }

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

const CATEGORY_LABELS: Record<CategoryV2, { emoji: string; label: string }> = {
  nw_success:                   { emoji: "✅", label: "success" },
  nw_published_directional:     { emoji: "🟢", label: "published directional" },
  nw_published_bad:             { emoji: "❌", label: "published bad" },
  nw_miss_judge_killed_good:    { emoji: "🟠", label: "judge killed good" },
  nw_miss_judge_killed_bad:     { emoji: "✅", label: "judge killed bad" },
  nw_miss_verifier_killed_good: { emoji: "🟠", label: "verifier killed good" },
  nw_miss_verifier_killed_bad:  { emoji: "✅", label: "verifier killed bad" },
  nw_miss_writer_abstained:     { emoji: "❌", label: "writer abstained" },
  nw_miss_search_exhausted:     { emoji: "❌", label: "search exhausted" },
  nw_miss_satire_killed:        { emoji: "❌", label: "satire killed good" },
  nnw_correct_writer_abstained: { emoji: "✅", label: "nnw writer abstained" },
  nnw_correct_judge_rejected:   { emoji: "✅", label: "nnw judge rejected" },
  nnw_correct_verifier_rejected:{ emoji: "✅", label: "nnw verifier rejected" },
  nnw_correct_search_exhausted: { emoji: "✅", label: "nnw search exhausted" },
  nnw_correct_satire_rejected:  { emoji: "✅", label: "nnw satire rejected" },
  nnw_fp_harmless:              { emoji: "🟡", label: "fp harmless" },
  nnw_fp_published:             { emoji: "❌", label: "false positive" },
  nnw_eval_disagrees:           { emoji: "🟡", label: "eval disagrees" },
  uncategorized:                { emoji: "❓", label: "uncategorized" },
};

function formatResult(r: CompletedResult, count: number, total: number): string {
  const reason = r.outcomeReason ? ` (${r.outcomeReason})` : "";
  const lines: string[] = [];

  if (r.categorized) {
    const { emoji, label } = CATEGORY_LABELS[r.categorized.category]!;
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

function printSummary(counts: BucketCountsV2, totalProcessed: number, errors: number, outputPath: string) {
  const nwSuccess = counts.nw_success;
  const nwDirectional = counts.nw_published_directional;
  const nwBad = counts.nw_published_bad;
  const nwMissed = counts.nw_miss_judge_killed_good + counts.nw_miss_judge_killed_bad
    + counts.nw_miss_verifier_killed_good + counts.nw_miss_verifier_killed_bad
    + counts.nw_miss_writer_abstained + counts.nw_miss_search_exhausted
    + counts.nw_miss_satire_killed;
  const nwTotal = nwSuccess + nwDirectional + nwBad + nwMissed;

  const nnwCorrect = counts.nnw_correct_writer_abstained + counts.nnw_correct_judge_rejected
    + counts.nnw_correct_verifier_rejected + counts.nnw_correct_search_exhausted
    + counts.nnw_correct_satire_rejected;
  const nnwHarmless = counts.nnw_fp_harmless;
  const nnwHardFP = counts.nnw_fp_published;
  const nnwDisagrees = counts.nnw_eval_disagrees;
  const nnwTotal = nnwCorrect + nnwHarmless + nnwHardFP + nnwDisagrees;

  const scoredTotal = nwTotal + nnwTotal;
  // Directional notes are net-helpful and count as wins; harmless extra notes are
  // tolerated but NOT counted correct (we still published when none was needed).
  const overallCorrect = nwSuccess + nwDirectional + nnwCorrect;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULTS: ${totalProcessed} processed, ${errors} errors`);
  console.log(`Output: ${outputPath}`);

  if (nwTotal > 0) {
    console.log(`\n  NOTEWORTHY (ground truth = yes): ${nwTotal} tweets`);
    console.log(`    success:              ${fmtRate(nwSuccess, nwTotal).padEnd(16)}`);
    console.log(`    published directional:${fmtRate(nwDirectional, nwTotal).padEnd(16)}`);
    console.log(`    published bad:        ${fmtRate(nwBad, nwTotal).padEnd(16)}`);
    console.log(`    judge killed good:    ${fmtRate(counts.nw_miss_judge_killed_good, nwTotal).padEnd(16)}`);
    console.log(`    judge killed bad:     ${fmtRate(counts.nw_miss_judge_killed_bad, nwTotal).padEnd(16)}`);
    console.log(`    verifier killed good: ${fmtRate(counts.nw_miss_verifier_killed_good, nwTotal).padEnd(16)}`);
    console.log(`    verifier killed bad:  ${fmtRate(counts.nw_miss_verifier_killed_bad, nwTotal).padEnd(16)}`);
    console.log(`    writer abstained:     ${fmtRate(counts.nw_miss_writer_abstained, nwTotal).padEnd(16)}`);
    console.log(`    search exhausted:     ${fmtRate(counts.nw_miss_search_exhausted, nwTotal).padEnd(16)}`);
    console.log(`    satire killed good:   ${fmtRate(counts.nw_miss_satire_killed, nwTotal).padEnd(16)}`);
  }

  if (nnwTotal > 0) {
    console.log(`\n  NON-NOTEWORTHY (ground truth = no): ${nnwTotal} tweets`);
    console.log(`    correct (no publish): ${fmtRate(nnwCorrect, nnwTotal).padEnd(16)}`);
    console.log(`    fp harmless:          ${fmtRate(nnwHarmless, nnwTotal).padEnd(16)}`);
    console.log(`    fp published (HARMFUL):${fmtRate(nnwHardFP, nnwTotal).padEnd(16)}`);
    console.log(`    eval disagrees:       ${fmtRate(nnwDisagrees, nnwTotal).padEnd(16)}`);
  }

  if (scoredTotal > 0) {
    console.log(`\n  OVERALL: ${fmtRate(overallCorrect, scoredTotal)}`);
    console.log(`  HARD FP RATE (harmful notes on no-note posts): ${fmtRate(nnwHardFP, nnwTotal)}`);
    console.log(`  PUBLISHED-WHEN-NOT-NEEDED (harmful + harmless):  ${fmtRate(nnwHarmless + nnwHardFP, nnwTotal)}`);
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
  const categorizedRows: CategorizedRowV2[] = [];
  let completedCount = 0;
  let errorCount = 0;

  // All searches funnel through a single global 3s-gap queue, so with 5
  // concurrent workers each making ~3 queries the queue wait alone can be
  // 45s+. Factor in SearXNG cool-downs / retries and a single tweet can
  // legitimately take 15+ min. 20 min catches real hangs without killing
  // slow-but-progressing rows.
  const PER_TWEET_TIMEOUT_MS = 20 * 60 * 1000;
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

        let resultLabel = "";
        try {
          const categorized = await categorizeRowV2(csvRowData);
          completed.categorized = categorized;
          categorizedRows.push(categorized);
          resultLabel = categorized.category;
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

  const counts = writeResultJsonsV2(categorizedRows, output.folderPath);
  printSummary(counts, inputs.length, errorCount, output.folderPath);

  if (cleanup) {
    try { await cleanup(); } catch {}
  }

  try { await closeBrowser(); } catch {}

  await uploadResults();
}
