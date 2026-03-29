/**
 * Evaluate Results
 *
 * AI judge for community note evaluation. Can be used per-item (from runOnVideos)
 * or standalone on an existing CSV.
 *
 * Usage:
 *   bun run src/scripts/evaluateResults.ts <results.csv> [output-dir]
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../utils/csv";
import { llm } from "../pipeline/llm";

const JUDGE_MODEL = "anthropic/claude-opus-4-6";
const CORRECTION_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION";
const DROP_COLUMNS = new Set(["search_results", "citations"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CsvRow {
  [key: string]: string;
}

interface ParsedRow {
  [key: string]: unknown;
}

export interface JudgeVerdict {
  correct: boolean;
}

export type Category =
  | "note_worthy_correct"
  | "note_worthy_incorrect"
  | "note_worthy_not_proposed"
  | "non_note_worthy_correct"
  | "non_note_worthy_incorrect"
  | "uncategorized";

export interface CategorizedRow {
  category: Category;
  parsed: ParsedRow;
  verdict?: JudgeVerdict;
}

export type BucketCounts = Record<Category, number>;

export const CATEGORY_RESULT_LABEL: Record<Category, string> = {
  note_worthy_correct: "correct",
  note_worthy_incorrect: "incorrect",
  note_worthy_not_proposed: "missed",
  non_note_worthy_correct: "correct",
  non_note_worthy_incorrect: "false positive",
  uncategorized: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function noteWasProposed(row: CsvRow): boolean {
  return row.note_status === CORRECTION_STATUS;
}

export function isNoteworthy(row: CsvRow): boolean | null {
  const truth = (row.needs_note ?? "").trim().toLowerCase();
  if (truth === "yes") return true;
  if (truth === "no") return false;
  return null;
}

function parseRowForJson(row: CsvRow): ParsedRow {
  const out: ParsedRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (DROP_COLUMNS.has(k)) continue;
    if (k === "logs" && v) {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-item AI Judge
// ---------------------------------------------------------------------------

export async function judgeRow(row: CsvRow): Promise<JudgeVerdict> {
  const prompt = `Judge whether the proposed note is directionally correct, given what you know about the ground truth note. Reply JSON: {"correct": true/false}

Tweet: ${row.text}
Ground truth: ${row.ground_truth_note}
Proposed note: ${row.note_text}`;

  try {
    const result = await llm.create({
      model: JUDGE_MODEL,
      temperature: 1,
      messages: [{ role: "user", content: prompt }],
      // @ts-expect-error OpenRouter extended thinking
      reasoning: { effort: "low" },
    });

    const content = result.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { correct: !!parsed.correct };
    }
  } catch (err: any) {
    console.error(`[judge] Failed: ${err?.message}`);
  }

  return { correct: false };
}

// ---------------------------------------------------------------------------
// Categorize a single row (calls judge if needed)
// ---------------------------------------------------------------------------

export async function categorizeRow(row: CsvRow): Promise<CategorizedRow> {
  const noteworthy = isNoteworthy(row);
  const proposed = noteWasProposed(row);
  const parsed = parseRowForJson(row);

  if (noteworthy === null) return { category: "uncategorized", parsed };

  if (noteworthy) {
    if (!proposed) {
      return { category: "note_worthy_not_proposed", parsed };
    }
    const verdict = await judgeRow(row);
    return {
      category: verdict.correct ? "note_worthy_correct" : "note_worthy_incorrect",
      parsed,
      verdict,
    };
  } else {
    return {
      category: proposed ? "non_note_worthy_incorrect" : "non_note_worthy_correct",
      parsed,
    };
  }
}

// ---------------------------------------------------------------------------
// Write JSONs from accumulated results
// ---------------------------------------------------------------------------

export function writeResultJsons(results: CategorizedRow[], outputDir: string): BucketCounts {
  const buckets: Record<Category, ParsedRow[]> = {
    note_worthy_correct: [],
    note_worthy_incorrect: [],
    note_worthy_not_proposed: [],
    non_note_worthy_correct: [],
    non_note_worthy_incorrect: [],
    uncategorized: [],
  };

  for (const r of results) {
    buckets[r.category].push(r.parsed);
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const counts: BucketCounts = {} as BucketCounts;
  for (const [category, data] of Object.entries(buckets)) {
    const outPath = path.join(outputDir, `${category}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    counts[category as Category] = data.length;
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Standalone: evaluate a CSV file
// ---------------------------------------------------------------------------

export async function evaluateResults(csvPath: string, outputDir: string): Promise<BucketCounts> {
  const content = fs.readFileSync(csvPath, "utf8").trim();
  const records = parseCsvRecords(content);
  if (records.length < 2) {
    console.log("[evaluate] No rows to evaluate");
    return { note_worthy_correct: 0, note_worthy_incorrect: 0, note_worthy_not_proposed: 0, non_note_worthy_correct: 0, non_note_worthy_incorrect: 0, uncategorized: 0 };
  }

  const headers = records[0]!.map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i]!;
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = fields[j] ?? "";
    }
    rows.push(row);
  }

  console.log(`[evaluate] Loaded ${rows.length} rows from ${csvPath}`);

  const results: CategorizedRow[] = [];

  for (const row of rows) {
    results.push(await categorizeRow(row));
  }

  return writeResultJsons(results, outputDir);
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun run src/scripts/evaluateResults.ts <results.csv> [output-dir]");
    process.exit(1);
  }

  const csvPath = args[0]!;
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const outputDir = args[1] ?? path.dirname(csvPath);
  evaluateResults(csvPath, outputDir).catch((err) => {
    console.error("[evaluate] Fatal error:", err);
    process.exit(1);
  });
}
