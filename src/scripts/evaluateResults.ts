/**
 * Evaluate Results
 *
 * Reads a runOnVideos results CSV, uses an AI judge (Claude Opus 4.6) to
 * evaluate noteworthy tweets with proposed notes, and writes 5 categorized
 * JSON files.
 *
 * Categories:
 *   - note_worthy_correct:      noteworthy + note proposed + judge says correct
 *   - note_worthy_incorrect:    noteworthy + note proposed + judge says incorrect
 *   - note_worthy_not_proposed: noteworthy + no note proposed
 *   - non_note_worthy_correct:  non-noteworthy + no note proposed
 *   - non_note_worthy_incorrect: non-noteworthy + note proposed
 *
 * Usage:
 *   bun run src/scripts/evaluateResults.ts <results.csv> [output-dir]
 *   (output-dir defaults to the directory containing the CSV)
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

interface CsvRow {
  [key: string]: string;
}

interface ParsedRow {
  [key: string]: unknown;
}

interface JudgeVerdict {
  index: number;
  correct: boolean;
  reasoning: string;
}

type Category =
  | "note_worthy_correct"
  | "note_worthy_incorrect"
  | "note_worthy_not_proposed"
  | "non_note_worthy_correct"
  | "non_note_worthy_incorrect";

// ---------------------------------------------------------------------------
// CSV reading
// ---------------------------------------------------------------------------

function readResultsCsv(csvPath: string): CsvRow[] {
  const content = fs.readFileSync(csvPath, "utf8").trim();
  const records = parseCsvRecords(content);
  if (records.length < 2) return [];

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

  return rows;
}

// ---------------------------------------------------------------------------
// Row transformation for JSON output
// ---------------------------------------------------------------------------

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
// AI Judge
// ---------------------------------------------------------------------------

function buildJudgePrompt(rows: { index: number; row: CsvRow }[]): string {
  const entries = rows.map(({ index, row }) => {
    return [
      `--- Entry ${index} ---`,
      `Tweet URL: ${row.url}`,
      `Tweet text: ${row.text}`,
      `Ground truth note: ${row.ground_truth_note}`,
      `Proposed note: ${row.note_text}`,
      `Note status: ${row.note_status}`,
      `Pipeline outcome: ${row.outcome}`,
    ].join("\n");
  });

  return `You are an expert judge evaluating community notes written by an AI system for social media posts.

For each entry below, a tweet was identified as needing a community note (ground truth). The AI pipeline proposed a note. Your job is to judge whether the proposed note is CORRECT — meaning it accurately addresses the misinformation in the tweet and is broadly consistent with the ground truth note.

A note is CORRECT if:
- It identifies the same core issue as the ground truth (even if worded differently)
- It provides accurate counter-information
- Its citations/sources support the correction

A note is INCORRECT if:
- It misses the main point of why the tweet is misleading
- It makes factual errors in its correction
- It fails to address the misinformation (e.g., says "not enough info" when the ground truth shows clear misinformation)
- The pipeline rejected the note or marked it as "not significantly incorrect" when the tweet IS misleading

Here are the entries to judge:

${entries.join("\n\n")}

Respond with a JSON array of objects, one per entry, in this exact format:
[
  { "index": <entry index>, "correct": <true or false>, "reasoning": "<brief explanation>" }
]

Return ONLY the JSON array, no other text.`;
}

async function runJudge(rows: { index: number; row: CsvRow }[]): Promise<Map<number, JudgeVerdict>> {
  if (rows.length === 0) return new Map();

  console.log(`[evaluate] Running AI judge on ${rows.length} noteworthy rows with proposed notes...`);

  const result = await llm.create({
    model: JUDGE_MODEL,
    temperature: 0,
    messages: [{ role: "user", content: buildJudgePrompt(rows) }],
  });

  const content = result.choices?.[0]?.message?.content ?? "";

  // Extract JSON from response (handle potential markdown code blocks)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error("[evaluate] AI judge returned no valid JSON. Raw response:", content.slice(0, 500));
    // Conservative fallback: mark all as incorrect
    const fallback = new Map<number, JudgeVerdict>();
    for (const { index } of rows) {
      fallback.set(index, { index, correct: false, reasoning: "AI judge response parsing failed" });
    }
    return fallback;
  }

  const verdicts: JudgeVerdict[] = JSON.parse(jsonMatch[0]);
  const map = new Map<number, JudgeVerdict>();
  for (const v of verdicts) {
    map.set(v.index, v);
  }

  // Fill in any missing verdicts conservatively
  for (const { index } of rows) {
    if (!map.has(index)) {
      map.set(index, { index, correct: false, reasoning: "AI judge did not return a verdict for this entry" });
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

function noteWasProposed(row: CsvRow): boolean {
  return row.note_status === CORRECTION_STATUS;
}

function isNoteworthy(row: CsvRow): boolean | null {
  const truth = (row.needs_note ?? "").trim().toLowerCase();
  if (truth === "yes") return true;
  if (truth === "no") return false;
  return null;
}

// ---------------------------------------------------------------------------
// Main evaluation logic (exported for use from runOnVideos)
// ---------------------------------------------------------------------------

export async function evaluateResults(csvPath: string, outputDir: string): Promise<void> {
  const rows = readResultsCsv(csvPath);
  if (rows.length === 0) {
    console.log("[evaluate] No rows to evaluate");
    return;
  }

  console.log(`[evaluate] Loaded ${rows.length} rows from ${csvPath}`);

  // Identify rows that need AI judging: noteworthy + note proposed
  const needsJudging: { index: number; row: CsvRow }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (isNoteworthy(row) === true && noteWasProposed(row)) {
      needsJudging.push({ index: i, row });
    }
  }

  // Run AI judge in a single batch call
  const verdicts = await runJudge(needsJudging);

  // Categorize all rows
  const buckets: Record<Category, ParsedRow[]> = {
    note_worthy_correct: [],
    note_worthy_incorrect: [],
    note_worthy_not_proposed: [],
    non_note_worthy_correct: [],
    non_note_worthy_incorrect: [],
  };

  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const noteworthy = isNoteworthy(row);
    const proposed = noteWasProposed(row);
    const parsed = parseRowForJson(row);

    if (noteworthy === null) {
      skipped++;
      continue;
    }

    if (noteworthy) {
      if (!proposed) {
        buckets.note_worthy_not_proposed.push(parsed);
      } else {
        const verdict = verdicts.get(i);
        if (verdict) {
          parsed.judge_reasoning = verdict.reasoning;
        }
        if (verdict?.correct) {
          buckets.note_worthy_correct.push(parsed);
        } else {
          buckets.note_worthy_incorrect.push(parsed);
        }
      }
    } else {
      if (proposed) {
        buckets.non_note_worthy_incorrect.push(parsed);
      } else {
        buckets.non_note_worthy_correct.push(parsed);
      }
    }
  }

  // Write JSON files
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  for (const [category, data] of Object.entries(buckets)) {
    const outPath = path.join(outputDir, `${category}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`[evaluate] ${category}: ${data.length} rows -> ${outPath}`);
  }

  if (skipped > 0) {
    console.log(`[evaluate] Skipped ${skipped} rows with no ground truth`);
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main() {
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
  await evaluateResults(csvPath, outputDir);
}

// Only run main when executed directly (not imported)
if (import.meta.main) {
  main().catch((err) => {
    console.error("[evaluate] Fatal error:", err);
    process.exit(1);
  });
}
