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
  parseRowForJson,
  writeResultJsons,
  type CsvRow,
  type CategorizedRow,
  type ParsedRow,
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
): { inputs: InputRow[]; forcedBotId?: string; sourceFile?: string } {
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

  if (isUrls) {
    inputs = transformed.map((url) => ({ url }));
  } else if (transformed.length === 1 && fs.existsSync(transformed[0]!)) {
    inputs = parseInputCsv(transformed[0]!);
    const ext = path.extname(transformed[0]!);
    return { inputs, forcedBotId, sourceFile: path.basename(transformed[0]!, ext) };
  } else {
    console.error(`File not found or invalid args: ${transformed[0]}`);
    process.exit(1);
  }

  return { inputs, forcedBotId };
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

function initOutputFolder(prefix: string, datasetName?: string): { folderPath: string; csvPath: string; appendRow: (row: string) => void } {
  const baseDir = path.join(process.cwd(), "dataset_runs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const suffix = datasetName ? `-${datasetName}` : "";
  const folderPath = path.join(baseDir, `${prefix}-${timestamp}${suffix}`);
  fs.mkdirSync(folderPath, { recursive: true });

  const csvPath = path.join(folderPath, "results.csv");
  fs.writeFileSync(csvPath, OUTPUT_HEADERS.join(",") + "\n", "utf8");

  return {
    folderPath,
    csvPath,
    appendRow: (row: string) => fs.appendFileSync(csvPath, row + "\n", "utf8"),
  };
}

// ---------------------------------------------------------------------------
// Resume from previous run
// ---------------------------------------------------------------------------

function findLatestRun(
  prefix: string,
  inputs: InputRow[],
  datasetName?: string,
): { folderPath: string; csvPath: string; processedUrls: Set<string> } | null {
  const baseDir = path.join(process.cwd(), "dataset_runs");
  if (!fs.existsSync(baseDir)) return null;

  const folders = fs
    .readdirSync(baseDir)
    .filter((f) => {
      if (!f.startsWith(`${prefix}-`)) return false;
      if (datasetName && !f.endsWith(`-${datasetName}`)) return false;
      return fs.statSync(path.join(baseDir, f)).isDirectory();
    })
    .sort();
  if (folders.length === 0) return null;

  const latestFolder = path.join(baseDir, folders.at(-1)!);
  const csvPath = path.join(latestFolder, "results.csv");
  if (!fs.existsSync(csvPath)) return null;

  const content = fs.readFileSync(csvPath, "utf8").trim();
  const records = parseCsvRecords(content);
  if (records.length <= 1) return null;

  const processedUrls = new Set<string>();
  for (let i = 1; i < records.length; i++) {
    const url = records[i]?.[0]?.trim();
    if (url) processedUrls.add(url);
  }

  const inputUrls = new Set(inputs.map((i) => i.url));

  // Already complete — start fresh
  if (processedUrls.size >= inputUrls.size) return null;

  // Only resume if processed URLs are from the same input set
  for (const u of processedUrls) {
    if (!inputUrls.has(u)) return null;
  }

  return { folderPath: latestFolder, csvPath, processedUrls };
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

  // Check for a resumable previous run
  const previousRun = findLatestRun(folderPrefix, inputs, datasetName);
  const processedUrls = previousRun?.processedUrls ?? new Set<string>();
  let output: { folderPath: string; csvPath: string; appendRow: (row: string) => void };

  if (previousRun) {
    console.log(
      `[${scriptName}] Resuming from ${path.basename(previousRun.folderPath)} (${processedUrls.size}/${inputs.length} already done)`
    );
    output = {
      folderPath: previousRun.folderPath,
      csvPath: previousRun.csvPath,
      appendRow: (row: string) => fs.appendFileSync(previousRun.csvPath, row + "\n", "utf8"),
    };
  } else {
    output = initOutputFolder(folderPrefix, datasetName);
  }

  const remaining = inputs.length - processedUrls.size;
  console.log(`[${scriptName}] Processing ${remaining} remaining item(s)`);
  console.log(`[${scriptName}] Output folder: ${output.folderPath}`);

  const results: CompletedResult[] = [];
  const categorizedRows: CategorizedRow[] = [];
  const uncategorizedRows: ParsedRow[] = [];
  let completedCount = processedUrls.size;
  let errorCount = 0;

  const queue = new PQueue({ concurrency });

  for (const [idx, input] of inputs.entries()) {
    if (processedUrls.has(input.url)) continue;
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
          else uncategorizedRows.push(parseRowForJson(csvRowData));
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

  let allCategorized: CategorizedRow[];
  let allUncategorized: ParsedRow[];
  let totalProcessed: number;
  let totalErrors: number;

  if (processedUrls.size > 0) {
    // Resumed run — re-categorize from complete CSV for full summary
    console.log(`\n[${scriptName}] Building full summary from all ${inputs.length} items...`);
    const fullContent = fs.readFileSync(output.csvPath, "utf8").trim();
    const fullRecords = parseCsvRecords(fullContent);
    allCategorized = [];
    allUncategorized = [];
    totalErrors = 0;

    if (fullRecords.length > 1) {
      const headers = fullRecords[0]!.map((h) => h.trim());
      for (let i = 1; i < fullRecords.length; i++) {
        const row: CsvRow = {};
        for (let j = 0; j < headers.length; j++) {
          row[headers[j]!] = fullRecords[i]?.[j] ?? "";
        }
        if (row.outcome?.startsWith("error")) {
          totalErrors++;
          continue;
        }
        try {
          const cat = await categorizeRow(row);
          if (cat) allCategorized.push(cat);
          else allUncategorized.push(parseRowForJson(row));
        } catch {}
      }
    }
    totalProcessed = fullRecords.length - 1;
  } else {
    allCategorized = categorizedRows;
    allUncategorized = uncategorizedRows;
    totalProcessed = remaining;
    totalErrors = errorCount;
  }

  const counts = writeResultJsons(allCategorized, output.folderPath, allUncategorized);
  printSummary(counts, totalProcessed, totalErrors, output.folderPath);

  if (cleanup) {
    try { await cleanup(); } catch {}
  }

  try { await closeBrowser(); } catch {}
}
