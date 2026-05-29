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
import { llm } from "../pipeline/llm/llm";

const JUDGE_MODEL = "anthropic/claude-sonnet-4-6";
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

// 3-tier note quality. "good" = fully meets the bar; "directional" = accurate
// and net-helpful but incomplete (misses some guidance specifics, or — on a post
// that needs no note — is an accurate-but-unnecessary addition that does no harm);
// "bad" = inaccurate, misleading, off-topic, or misses the central claim.
export type VerdictTier = "good" | "directional" | "bad";

export interface JudgeVerdict {
  tier: VerdictTier;
  reason?: string;
}

/** Back-compat boolean for callers that only care about pass/fail: a directional
 *  note still counts as net-helpful (not a hard failure). */
export function verdictPassed(v: JudgeVerdict | undefined): boolean {
  return v !== undefined && v.tier !== "bad";
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

// ─── V2 categorization ───────────────────────────────────────────────────────
// 18-bucket scheme that crosses (pipeline stage that blocked the note) ×
// (writer-stage note quality, judged independently) × (ground truth). Lets
// us tell apart "judge killed a good note" from "judge correctly killed a
// bad note" so we know whether to fix the writer or the judge.

export type CategoryV2 =
  | "nw_success"
  | "nw_published_directional"
  | "nw_published_bad"
  | "nw_miss_judge_killed_good"
  | "nw_miss_judge_killed_bad"
  | "nw_miss_verifier_killed_good"
  | "nw_miss_verifier_killed_bad"
  | "nw_miss_writer_abstained"
  | "nw_miss_search_exhausted"
  | "nw_miss_satire_killed"
  | "nnw_correct_writer_abstained"
  | "nnw_correct_judge_rejected"
  | "nnw_correct_verifier_rejected"
  | "nnw_correct_search_exhausted"
  | "nnw_correct_satire_rejected"
  | "nnw_fp_harmless"
  | "nnw_fp_published"
  | "nnw_eval_disagrees"
  | "uncategorized";

export type StageBlock = "published" | "writer_abstained" | "judge_rejected" | "verifier_rejected" | "search_exhausted" | "satire_rejected" | "unknown";

export interface CategorizedRowV2 {
  category: CategoryV2;
  parsed: ParsedRow;
  stage_block: StageBlock;
  proposed_note_text: string | null;
  proposed_note_verdict?: JudgeVerdict; // AI judge on the writer's pre-pipeline note
  published_note_verdict?: JudgeVerdict; // AI judge on the published note (if any)
}

export type BucketCountsV2 = Record<CategoryV2, number>;

const V2_BUCKETS: CategoryV2[] = [
  "nw_success",
  "nw_published_directional",
  "nw_published_bad",
  "nw_miss_judge_killed_good",
  "nw_miss_judge_killed_bad",
  "nw_miss_verifier_killed_good",
  "nw_miss_verifier_killed_bad",
  "nw_miss_writer_abstained",
  "nw_miss_search_exhausted",
  "nw_miss_satire_killed",
  "nnw_correct_writer_abstained",
  "nnw_correct_judge_rejected",
  "nnw_correct_verifier_rejected",
  "nnw_correct_search_exhausted",
  "nnw_correct_satire_rejected",
  "nnw_fp_harmless",
  "nnw_fp_published",
  "nnw_eval_disagrees",
  "uncategorized",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function noteWasProposed(row: CsvRow): boolean {
  if (row.note_status !== CORRECTION_STATUS) return false;
  const outcome = row.outcome ?? "";
  return !outcome.includes("check_failed") && !outcome.includes("check_error");
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

export async function judgeRow(row: CsvRow, sources?: string[]): Promise<JudgeVerdict> {
  // big_eval datasets carry self-contained judge guidance so a context-free Opus
  // can score strictly; for failure rows it must also check the note doesn't repeat
  // the original note's specific failure. Plain datasets fall back to ground-truth.
  const guidance = (row.judge_guidance ?? "").trim();
  const originalNote = (row.original_note_text ?? "").trim();
  const failureReason = (row.failure_reason ?? "").trim();

  const parts = [
    `Rate the proposed Community Note for this tweet. Reply JSON: {"rating": "good" | "directional" | "bad", "reason": "<one sentence>"}`,
    ``,
    `Ratings:`,
    `- "good": accurate, well-sourced, and addresses the tweet's central misleading claim (and satisfies the judge guidance if one is given).`,
    `- "directional": accurate and points the right way but incomplete — it misses some specifics the guidance asks for, addresses only a side issue, or adds accurate, non-essential context to a post whose core is already true. Net-neutral to helpful; not harmful to publish.`,
    `- "bad": inaccurate, misleading, unsupported, off-topic, or it fails to address the tweet's central claim. Publishing it would be a mistake. A note that fact-checks satire, a joke, a comedy bit, or an opinion as if it were a sincere factual claim is "bad" even when its individual facts are accurate — it misreads the post. If the guidance says the correct action is to NOT write a note (decline), then ANY published note is "bad", never "directional".`,
    ``,
    `Tweet: ${row.text}`,
  ];
  if (row.ground_truth_note) parts.push(`Reference of a good note: ${row.ground_truth_note}`);
  if (originalNote) {
    parts.push(
      `A PRIOR note on this tweet was rated NOT HELPFUL${failureReason ? ` (${failureReason})` : ""}: "${originalNote}".`,
      `The proposed note must avoid repeating that failure.`,
    );
  }
  if (guidance) parts.push(`What a correct note must do (judge guidance): ${guidance}`);
  parts.push(`Proposed note: ${row.note_text}`);
  // The published note carries its sources separately (as a CN "sources" field),
  // so the judge must see them too — otherwise a well-sourced note looks
  // sourceless and fails any "must cite a loadable source" guidance.
  if (sources && sources.length) parts.push(`Note's cited sources:\n${sources.join("\n")}`);

  try {
    const result = await llm.create({
      model: JUDGE_MODEL,
      temperature: 1,
      messages: [{ role: "user", content: parts.join("\n") }],
      // @ts-expect-error OpenRouter extended thinking
      reasoning: { effort: "low" },
    });

    const content = result.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const rating = String(parsed.rating ?? "").toLowerCase();
      const tier: VerdictTier = rating === "good" ? "good" : rating === "directional" ? "directional" : "bad";
      return { tier, reason: parsed.reason };
    }
  } catch (err: any) {
    console.error(`[judge] Failed: ${err?.message}`);
  }

  return { tier: "bad" };
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
      category: verdictPassed(verdict) ? "note_worthy_correct" : "note_worthy_incorrect",
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
// V2: stage detection + per-row categorizer
// ---------------------------------------------------------------------------

function getLogsObject(row: CsvRow): any {
  if (!row.logs) return null;
  try { return typeof row.logs === "string" ? JSON.parse(row.logs) : row.logs; } catch { return null; }
}

/** Pull writer's PROPOSED note from logs (i.e. what the writer LLM returned,
 *  independent of whether the pipeline ultimately published it). Returns null
 *  when the writer was never invoked OR returned empty. */
export function extractProposedNote(logsObj: any): { noteText: string; sources: string[] } | null {
  if (!logsObj) return null;
  const writer = logsObj?.note_writer_steps?.note_writer;
  const a0 = writer?.attempts?.["0"] ?? writer?.attempts?.[0];
  const noteText = String(a0?.response?.note_text ?? "").trim();
  if (!noteText) return null;
  const sources: string[] = Array.isArray(a0?.response?.sources) ? a0.response.sources : [];
  return { noteText, sources };
}

/** Determine which pipeline stage gated the row's outcome. Reads the
 *  orchestrator's recorded outcome + per-stage log presence. */
export function inferStageBlock(row: CsvRow, logsObj: any): StageBlock {
  if (noteWasProposed(row)) return "published";

  const reason = String(logsObj?.outcome?.reason ?? row.outcome ?? "");
  if (/satire_detected/i.test(reason)) return "satire_rejected";
  if (/searxng_all_providers_exhausted|no_evidence_found/i.test(reason)) return "search_exhausted";
  if (/writer_returned_empty/i.test(reason)) return "writer_abstained";
  if (/verification_failed/i.test(reason)) return "verifier_rejected";

  // Look at per-stage logs to disambiguate.
  const judgeMsgs = logsObj?.note_writer_steps?.note_needed_judge?.messages;
  const judgeMsg1 = judgeMsgs?.["1"] ?? judgeMsgs?.[1];
  if (judgeMsg1?.content) {
    let dec: any = judgeMsg1.content;
    if (typeof dec === "string") { try { dec = JSON.parse(dec); } catch {} }
    if (dec && typeof dec === "object" && "note_needed" in dec) {
      if (!dec.note_needed) return "judge_rejected";
      // judge passed but note not proposed → verifier killed it
      return "verifier_rejected";
    }
  }
  // No judge log → likely search-stage block or writer abstained without
  // logging the reason explicitly.
  const proposed = extractProposedNote(logsObj);
  if (!proposed) {
    // No writer output either — search must have failed.
    return "search_exhausted";
  }
  // Writer produced a note but no judge ran and not published — weird, but
  // most likely the orchestrator short-circuited after writer.
  return "writer_abstained";
}

/** AI judge against ground truth, on an arbitrary proposed-note string
 *  (not row.note_text). Used by V2 to judge the writer's pre-pipeline output. */
export async function judgeProposedNote(row: CsvRow, proposedNoteText: string, sources?: string[]): Promise<JudgeVerdict> {
  return judgeRow({ ...row, note_text: proposedNoteText }, sources);
}

/** Ground truth = note needed, and we published. Map the judge's tier to a
 *  bucket: directional notes are net-helpful but imperfect, distinct from bad. */
function tierToNwPublished(tier?: VerdictTier): CategoryV2 {
  if (tier === "good") return "nw_success";
  if (tier === "directional") return "nw_published_directional";
  return "nw_published_bad";
}

/** Ground truth = no note needed, and we published anyway. A "good" note means
 *  the judge thinks a note was actually warranted (eval disagrees with GT); a
 *  "directional" note is accurate but unnecessary — published when none was
 *  needed, yet harmless; a "bad" note is a genuinely harmful false positive. */
function tierToNnwPublished(tier?: VerdictTier): CategoryV2 {
  if (tier === "good") return "nnw_eval_disagrees";
  if (tier === "directional") return "nnw_fp_harmless";
  return "nnw_fp_published";
}

export async function categorizeRowV2(row: CsvRow): Promise<CategorizedRowV2> {
  const noteworthy = isNoteworthy(row);
  const parsed = parseRowForJson(row);
  const logsObj = getLogsObject(row);
  const stage_block = inferStageBlock(row, logsObj);
  const proposed = extractProposedNote(logsObj);

  if (noteworthy === null) {
    return { category: "uncategorized", parsed, stage_block, proposed_note_text: proposed?.noteText ?? null };
  }

  // Judge the published note if there is one (when published).
  let publishedVerdict: JudgeVerdict | undefined;
  if (stage_block === "published") {
    publishedVerdict = await judgeRow(row, proposed?.sources);
  }

  // Judge the writer's proposed note independently — but only when there IS one
  // and it's NOT identical to the published note (avoid duplicate cost).
  let proposedVerdict: JudgeVerdict | undefined;
  if (proposed && stage_block !== "published") {
    proposedVerdict = await judgeProposedNote(row, proposed.noteText, proposed.sources);
  } else if (proposed && stage_block === "published") {
    // proposed == published in this case (writer's first-attempt note IS the
    // published note unless verifier rewrote it; we approximate as same).
    proposedVerdict = publishedVerdict;
  }

  const proposedGood = verdictPassed(proposedVerdict);

  let category: CategoryV2;
  if (noteworthy) {
    switch (stage_block) {
      case "published":
        category = tierToNwPublished(publishedVerdict?.tier);
        break;
      case "judge_rejected":
        category = proposedGood ? "nw_miss_judge_killed_good" : "nw_miss_judge_killed_bad";
        break;
      case "verifier_rejected":
        category = proposedGood ? "nw_miss_verifier_killed_good" : "nw_miss_verifier_killed_bad";
        break;
      case "writer_abstained":
        category = "nw_miss_writer_abstained";
        break;
      case "search_exhausted":
        category = "nw_miss_search_exhausted";
        break;
      case "satire_rejected":
        category = "nw_miss_satire_killed";
        break;
      default:
        category = "uncategorized";
    }
  } else {
    switch (stage_block) {
      case "published":
        category = tierToNnwPublished(publishedVerdict?.tier);
        break;
      case "judge_rejected":
        category = "nnw_correct_judge_rejected";
        break;
      case "verifier_rejected":
        category = "nnw_correct_verifier_rejected";
        break;
      case "writer_abstained":
        category = "nnw_correct_writer_abstained";
        break;
      case "search_exhausted":
        category = "nnw_correct_search_exhausted";
        break;
      case "satire_rejected":
        category = "nnw_correct_satire_rejected";
        break;
      default:
        category = "uncategorized";
    }
  }

  return {
    category,
    parsed,
    stage_block,
    proposed_note_text: proposed?.noteText ?? null,
    proposed_note_verdict: proposedVerdict,
    published_note_verdict: publishedVerdict,
  };
}

export function writeResultJsonsV2(results: CategorizedRowV2[], outputDir: string): BucketCountsV2 {
  const buckets: Record<CategoryV2, any[]> = Object.fromEntries(V2_BUCKETS.map((b) => [b, []])) as any;
  for (const r of results) {
    const enriched = {
      ...r.parsed,
      _v2_stage_block: r.stage_block,
      _v2_proposed_note: r.proposed_note_text,
      _v2_proposed_note_verdict: r.proposed_note_verdict ?? null,
      _v2_published_note_verdict: r.published_note_verdict ?? null,
    };
    buckets[r.category].push(enriched);
  }
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const counts: BucketCountsV2 = {} as BucketCountsV2;
  for (const b of V2_BUCKETS) {
    fs.writeFileSync(path.join(outputDir, `${b}.json`), JSON.stringify(buckets[b], null, 2) + "\n", "utf8");
    counts[b] = buckets[b].length;
  }
  return counts;
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

function loadCsvRows(csvPath: string): CsvRow[] {
  const content = fs.readFileSync(csvPath, "utf8").trim();
  const records = parseCsvRecords(content);
  if (records.length < 2) return [];
  const headers = records[0]!.map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i]!;
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]!] = fields[j] ?? "";
    rows.push(row);
  }
  return rows;
}

export async function evaluateResults(csvPath: string, outputDir: string): Promise<BucketCounts> {
  const rows = loadCsvRows(csvPath);
  if (rows.length === 0) {
    console.log("[evaluate] No rows to evaluate");
    return { note_worthy_correct: 0, note_worthy_incorrect: 0, note_worthy_not_proposed: 0, non_note_worthy_correct: 0, non_note_worthy_incorrect: 0, uncategorized: 0 };
  }
  console.log(`[evaluate] Loaded ${rows.length} rows from ${csvPath}`);
  const results: CategorizedRow[] = [];
  for (const row of rows) results.push(await categorizeRow(row));
  return writeResultJsons(results, outputDir);
}

export async function evaluateResultsV2(csvPath: string, outputDir: string): Promise<BucketCountsV2> {
  const rows = loadCsvRows(csvPath);
  if (rows.length === 0) {
    console.log("[evaluate-v2] No rows to evaluate");
    return Object.fromEntries(V2_BUCKETS.map((b) => [b, 0])) as BucketCountsV2;
  }
  console.log(`[evaluate-v2] Loaded ${rows.length} rows from ${csvPath}`);
  const results: CategorizedRowV2[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = await categorizeRowV2(rows[i]!);
    results.push(r);
    if ((i + 1) % 10 === 0 || i === rows.length - 1) {
      console.log(`[evaluate-v2] ${i + 1}/${rows.length} categorized; latest: ${r.category} (stage=${r.stage_block})`);
    }
  }
  return writeResultJsonsV2(results, outputDir);
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const v2Flag = args.includes("--v2") || process.env.EVAL_CATEGORIZER === "v2";
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length === 0) {
    console.error("Usage: bun run src/local/evaluateResults.ts <results.csv> [output-dir] [--v2]");
    process.exit(1);
  }

  const csvPath = positional[0]!;
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const outputDir = positional[1] ?? path.dirname(csvPath);
  const fn = v2Flag ? evaluateResultsV2 : evaluateResults;
  console.log(`[evaluate] categorizer version: ${v2Flag ? "v2" : "v1"}`);
  fn(csvPath, outputDir).then((counts) => {
    console.log("[evaluate] Final counts:");
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(36)} ${v}`);
  }).catch((err) => {
    console.error("[evaluate] Fatal error:", err);
    process.exit(1);
  });
}
