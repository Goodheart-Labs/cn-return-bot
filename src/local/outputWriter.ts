/**
 * Shared output utilities for writing pipeline results to dataset_runs/.
 * Used by both localPipelineRunner (tryoutNotes) and generateCandidates (--local).
 */

import * as fs from "fs";
import * as path from "path";
import type { ProcessTweetResult } from "../pipeline/orchestration/processTweet";
import { nestDotKeys } from "../pipeline/utils/tweetLog";
import { escapeCsvField } from "../utils/csv";

export const OUTPUT_HEADERS = [
  "url",
  "text",
  "needs_note",
  "ground_truth_note",
  "bot_id",
  "note_status",
  "outcome",
  "result",
  "note_text",
  "source_verification",
  "evaluation_score",
  "logs",
] as const;

export interface OutputFolder {
  folderPath: string;
  csvPath: string;
  appendRow: (row: string) => void;
}

export function buildRunName(
  folderPrefix: string,
  datasetName?: string,
  botId?: string,
  configName?: string,
): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const parts = [folderPrefix, datasetName ?? "run", botId, configName].filter(Boolean);
  return `${parts.join("_")}_${ts}`;
}

export function initOutputFolder(prefix: string, datasetName?: string, botName?: string): OutputFolder {
  const baseDir = path.join(process.cwd(), "dataset_runs");
  // YYYYMMDDHHmmssSSS-<pid> — ms precision + PID keep parallel runs from colliding
  const iso = new Date().toISOString(); // 2026-04-19T08:50:12.345Z
  const stamp = iso.replace(/[-:T.Z]/g, "").slice(0, 17); // 20260419085012345
  const timestamp = `${stamp}-${process.pid}`;
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

export interface CsvRowInput {
  url: string;
  needsNote?: string;
  groundTruthNote?: string;
}

export function resultToCsvRow(
  input: CsvRowInput,
  botId: string,
  result: ProcessTweetResult,
  resultLabel: string,
  log?: Map<string, unknown>,
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
    result: resultLabel,
    note_text: result.noteText ?? "",
    source_verification: svScore?.label ?? (svScore ? String(svScore.value) : "skipped"),
    evaluation_score: result.evaluationScore?.toFixed(2) ?? "",
    logs: log ? JSON.stringify(nestDotKeys(Object.fromEntries(log))) : "",
  };

  return OUTPUT_HEADERS.map((h) => escapeCsvField(fields[h])).join(",");
}

export function errorToCsvRow(url: string, errorMsg: string): string {
  return OUTPUT_HEADERS.map((h) =>
    escapeCsvField(
      h === "url" ? url :
        h === "outcome" ? `error: ${errorMsg}` :
          h === "result" ? "error" : ""
    )
  ).join(",");
}
