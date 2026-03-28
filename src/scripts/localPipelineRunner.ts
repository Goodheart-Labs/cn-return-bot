/**
 * Shared pipeline runner for tryoutNotes and runOnVideos.
 *
 * Each script provides a PostFetcher (how to get a Post from a URL) and
 * delegates the processing loop, output, AI judge, and summary to this module.
 */

import { SupabaseLogger } from "../api/supabaseClient";
import { selectRandomBot, getBotById, getEnabledBots } from "../bots";
import { processSingleTweet, type ProcessTweetResult } from "../pipeline/processTweet";
import { closeBrowser } from "../pipeline/browserManager";
import { createTweetLog, withTweetLog } from "../pipeline/tweetLog";
import type { Post } from "../api/fetchEligiblePosts";
import * as fs from "fs";
import * as path from "path";
import PQueue from "p-queue";
import { parseCsvRecords, escapeCsvField } from "../utils/csv";
import {
  categorizeRow,
  writeResultJsons,
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
}

export type PostFetcher = (input: InputRow) => Promise<{ post: Post; title: string }>;

interface CompletedResult {
  idx: number;
  url: string;
  title: string;
  outcome: string;
  outcomeReason?: string;
  noteText?: string;
  categorized?: CategorizedRow | null;
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

  const rows: InputRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i]!;
    const url = fields[urlIdx]?.trim();
    if (!url) continue;

    rows.push({
      url,
      needsNote: needsNoteIdx >= 0 ? fields[needsNoteIdx]?.trim() : undefined,
      groundTruthNote: groundTruthIdx >= 0 ? fields[groundTruthIdx]?.trim() : undefined,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

export function parseCliArgs(
  scriptName: string,
  opts?: { transformArg?: (arg: string) => string }
): { inputs: InputRow[]; forcedBotId?: string; datasetName: string } {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(`Usage: bun run src/scripts/${scriptName}.ts [--bot <bot-id>] <input.csv>`);
    console.error(`       bun run src/scripts/${scriptName}.ts [--bot <bot-id>] <url1> <url2> ...`);
    console.error("\nAvailable bots:", getEnabledBots().map((b) => b.id).join(", "));
    process.exit(1);
  }

  let forcedBotId: string | undefined;
  const botFlagIdx = args.indexOf("--bot");
  if (botFlagIdx !== -1) {
    forcedBotId = args[botFlagIdx + 1];
    if (!forcedBotId) {
      console.error("--bot requires a bot ID");
      process.exit(1);
    }
    if (!getBotById(forcedBotId)) {
      console.error(`Unknown bot: ${forcedBotId}`);
      console.error("Available bots:", getEnabledBots().map((b) => b.id).join(", "));
      process.exit(1);
    }
    args.splice(botFlagIdx, 2);
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

  return { inputs, forcedBotId, datasetName };
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------

const OUTPUT_HEADERS = [
  "url",
  "text",
  "needs_note",
  "ground_truth_note",
  "bot_id",
  "note_status",
  "outcome",
  "note_text",
  "source_verification",
  "evaluation_score",
  "logs",
] as const;

function resultToCsvRow(
  input: InputRow,
  botId: string,
  result: ProcessTweetResult,
  log?: Map<string, unknown>
): string {
  const pr = result.pipelineResult;
  const svScore = result.scores.find((s) => s.type === "source_verification");

  const fields: Record<(typeof OUTPUT_HEADERS)[number], string> = {
    url: input.url,
    text: pr?.post?.text ?? "",
    needs_note: input.needsNote ?? "",
    ground_truth_note: input.groundTruthNote ?? "",
    bot_id: botId,
    note_status: result.noteStatus ?? "",
    outcome: `${result.outcome}${result.outcomeReason ? ` (${result.outcomeReason})` : ""}`,
    note_text: result.noteText ?? "",
    source_verification: svScore?.label ?? (svScore ? String(svScore.value) : "skipped"),
    evaluation_score: result.evaluationScore?.toFixed(2) ?? "",
    logs: log ? JSON.stringify(Object.fromEntries(log)) : "",
  };

  return OUTPUT_HEADERS.map((h) => escapeCsvField(fields[h])).join(",");
}

function errorToCsvRow(input: InputRow, errorMsg: string): string {
  return OUTPUT_HEADERS.map((h) =>
    escapeCsvField(
      h === "url" ? input.url :
        h === "needs_note" ? (input.needsNote ?? "") :
          h === "ground_truth_note" ? (input.groundTruthNote ?? "") :
            h === "outcome" ? `error: ${errorMsg}` : ""
    )
  ).join(",");
}

function initOutputFolder(prefix: string, datasetName?: string, botName?: string): { folderPath: string; csvPath: string; appendRow: (row: string) => void } {
  const baseDir = path.join(process.cwd(), "dataset_runs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const folderPath = path.join(baseDir, `${prefix}-${timestamp}`);
  fs.mkdirSync(folderPath, { recursive: true });

  const csvName = [
    "results",
    datasetName,
    botName ?? "random",
  ].join("_") + ".csv";
  const csvPath = path.join(folderPath, csvName);
  fs.writeFileSync(csvPath, OUTPUT_HEADERS.join(",") + "\n", "utf8");

  return {
    folderPath,
    csvPath,
    appendRow: (row: string) => fs.appendFileSync(csvPath, row + "\n", "utf8"),
  };
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
  const skipped = totalProcessed - scoredTotal - errors;

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
  if (skipped > 0) {
    console.log(`  NO GROUND TRUTH: ${skipped} skipped`);
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
  forcedBotId?: string;
  datasetName?: string;
  concurrency?: number;
  cleanup?: () => Promise<void>;
}

export async function runPipeline(options: RunPipelineOptions): Promise<void> {
  const {
    scriptName,
    folderPrefix,
    inputs,
    fetchPost,
    forcedBotId,
    datasetName,
    concurrency = 5,
    cleanup,
  } = options;

  let logger: SupabaseLogger | null = null;
  try {
    logger = new SupabaseLogger();
    console.log(`[${scriptName}] Connected to Supabase at ${process.env.SUPABASE_URL}`);
  } catch {
    console.log(`[${scriptName}] No Supabase configured — running without DB logging`);
  }

  console.log(`[${scriptName}] Processing ${inputs.length} item(s)`);

  const output = initOutputFolder(folderPrefix, datasetName, forcedBotId);
  console.log(`[${scriptName}] Output folder: ${output.folderPath}`);

  const results: CompletedResult[] = [];
  const categorizedRows: CategorizedRow[] = [];
  let completedCount = 0;
  let errorCount = 0;

  const queue = new PQueue({ concurrency });

  for (const [idx, input] of inputs.entries()) {
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

        const bot = forcedBotId ? getBotById(forcedBotId)! : selectRandomBot();
        const log = createTweetLog();
        log.set("tweet.index", idx + 1);
        log.set("tweet.total", inputs.length);
        const result = await withTweetLog(log, () =>
          processSingleTweet({ post, bot, logger })
        );

        completed.outcome = result.outcome;
        completed.outcomeReason = result.outcomeReason;
        completed.noteText = result.noteText;
        output.appendRow(resultToCsvRow(input, bot.id, result, log));

        csvRowData = {
          url: input.url,
          text: result.pipelineResult?.post?.text ?? "",
          needs_note: input.needsNote ?? "",
          ground_truth_note: input.groundTruthNote ?? "",
          bot_id: bot.id,
          note_status: result.noteStatus ?? "",
          outcome: `${result.outcome}${result.outcomeReason ? ` (${result.outcomeReason})` : ""}`,
          note_text: result.noteText ?? "",
          logs: log ? JSON.stringify(Object.fromEntries(log)) : "",
        };
      } catch (err: any) {
        console.error(`[${scriptName}] ERROR ${input.url}: ${err?.message}`);
        output.appendRow(errorToCsvRow(input, err?.message ?? "unknown"));
        errorCount++;
      }

      if (csvRowData) {
        try {
          const categorized = await categorizeRow(csvRowData);
          completed.categorized = categorized;
          if (categorized) categorizedRows.push(categorized);
        } catch (err: any) {
          console.error(`[${scriptName}] Judge failed for ${input.url}: ${err?.message}`);
        }
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
}
