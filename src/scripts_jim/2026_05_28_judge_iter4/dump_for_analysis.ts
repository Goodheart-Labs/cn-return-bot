/**
 * Dump a human-readable JSON for thinking-about-the-judge.
 *
 * Two buckets:
 *   A) current_judge_mistakes — rows where the production (iter-4) judge
 *      disagrees with ground truth. Either:
 *        - needs_note=yes but iter-4 judge rejected (the note got killed
 *          by the judge when ground truth says publish), OR
 *        - needs_note=no  but iter-4 judge passed (FP — judge let a bad
 *          note through).
 *
 *   B) regressions_vs_new — rows where iter-4 judge was correct but the
 *      new judge (M1+ minimal-edit) got it wrong. These are the cases
 *      that pushed the new judge's score down vs production.
 *
 * Each entry carries the full tweet text, dataset annotation context,
 * the iter-4 writer's proposed note (which is what gets judged), iter-4
 * judge verdict + reasoning, and new judge verdict + reasoning.
 *
 * Reads from:
 *   - src/scripts_jim/2026_05_28_judge_iter4/replay_results.json  (verdicts)
 *   - dataset_runs/tryout-iter-04-cheap-bot-merged/results_iter-04-cheap-bot.csv
 */
import * as fs from "fs";
import * as path from "path";
import { parseCsvRecords } from "../../utils/csv";

const REPLAY = "src/scripts_jim/2026_05_28_judge_iter4/replay_results.json";
const CSV = "dataset_runs/tryout-iter-04-cheap-bot-merged/results_iter-04-cheap-bot.csv";
const OUT = "src/scripts_jim/2026_05_28_judge_iter4/judge_analysis_dump.json";

interface ReplayRow {
  url: string;
  needsNote: string;
  iter4Verdict: boolean | null;
  newVerdict: boolean | null;
  newReasoning: string;
  classification: string;
}

function loadCsvByUrl(): Map<string, Record<string, string>> {
  const recs = parseCsvRecords(fs.readFileSync(CSV, "utf8").trim());
  const headers = recs[0]!.map((h) => h.trim());
  const out = new Map<string, Record<string, string>>();
  for (const fields of recs.slice(1)) {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = fields[i] ?? ""));
    if (r.url) out.set(r.url, r);
  }
  return out;
}

interface CleanEntry {
  url: string;
  needs_note: string;
  ground_truth_note: string;
  judge_guidance: string;
  original_failed_note: string;
  failure_reason: string;
  tweet_text: string;
  iter4_writer_note: string;
  iter4_writer_sources: string[];
  iter4_judge_verdict: boolean | null;
  iter4_judge_reasoning: string;
  new_judge_verdict: boolean | null;
  new_judge_reasoning: string;
  classification: string;
  why_in_bucket: string;
}

function buildEntry(r: ReplayRow, csvRow: Record<string, string>, whyInBucket: string): CleanEntry {
  let writerNote = "";
  let writerSources: string[] = [];
  let iter4JudgeReasoning = "";
  try {
    const logs = JSON.parse(csvRow.logs ?? "{}");
    const a0 = logs?.simpleBot?.writer?.attempts?.["0"];
    if (a0?.response) {
      writerNote = String(a0.response.note_text ?? "");
      if (Array.isArray(a0.response.sources)) writerSources = a0.response.sources;
    }
    const msg1 = logs?.simpleBot?.judge?.messages?.["1"];
    if (msg1?.content) {
      let dec: any = msg1.content;
      if (typeof dec === "string") { try { dec = JSON.parse(dec); } catch {} }
      if (dec && typeof dec === "object") iter4JudgeReasoning = String(dec.reasoning ?? "");
    }
  } catch {}

  return {
    url: r.url,
    needs_note: r.needsNote,
    ground_truth_note: csvRow.ground_truth_note ?? "",
    judge_guidance: csvRow.judge_guidance ?? "",
    original_failed_note: csvRow.original_note_text ?? "",
    failure_reason: csvRow.failure_reason ?? "",
    tweet_text: csvRow.text ?? "",
    iter4_writer_note: writerNote,
    iter4_writer_sources: writerSources,
    iter4_judge_verdict: r.iter4Verdict,
    iter4_judge_reasoning: iter4JudgeReasoning,
    new_judge_verdict: r.newVerdict,
    new_judge_reasoning: r.newReasoning,
    classification: r.classification,
    why_in_bucket: whyInBucket,
  };
}

function main(): void {
  const replay = JSON.parse(fs.readFileSync(REPLAY, "utf8")) as ReplayRow[];
  const csvByUrl = loadCsvByUrl();

  const bucketA_currentJudgeMistakes: CleanEntry[] = [];
  const bucketB_regressionsVsNew: CleanEntry[] = [];

  for (const r of replay) {
    const csvRow = csvByUrl.get(r.url);
    if (!csvRow) continue;
    const truthYes = r.needsNote === "yes";

    // Bucket A: current (iter-4) judge disagrees with ground truth.
    if (r.iter4Verdict !== null) {
      if (truthYes && r.iter4Verdict === false) {
        bucketA_currentJudgeMistakes.push(
          buildEntry(r, csvRow, "iter-4 judge rejected a noteworthy tweet (missed publish)"),
        );
      } else if (!truthYes && r.iter4Verdict === true) {
        bucketA_currentJudgeMistakes.push(
          buildEntry(r, csvRow, "iter-4 judge passed a note on a non-noteworthy tweet (FP)"),
        );
      }
    }

    // Bucket B: current good, new bad.
    if (r.classification === "FP_REGRESSION") {
      bucketB_regressionsVsNew.push(
        buildEntry(r, csvRow, "iter-4 correctly rejected; new judge incorrectly passes (FP regression)"),
      );
    } else if (r.classification === "TP_LOST") {
      bucketB_regressionsVsNew.push(
        buildEntry(r, csvRow, "iter-4 correctly passed; new judge incorrectly rejects (TP lost)"),
      );
    }
  }

  const out = {
    summary: {
      bucket_a_current_judge_mistakes_count: bucketA_currentJudgeMistakes.length,
      bucket_b_regressions_vs_new_count: bucketB_regressionsVsNew.length,
      buckets: {
        A: "Cases where the production (iter-4) judge disagrees with ground truth — opportunities for improvement.",
        B: "Cases where iter-4 was correct but the new (M1+ minimal-edit) judge regressed — the cost of decomposition.",
      },
    },
    bucket_a_current_judge_mistakes: bucketA_currentJudgeMistakes,
    bucket_b_regressions_vs_new: bucketB_regressionsVsNew,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(`  Bucket A (current judge mistakes):   ${bucketA_currentJudgeMistakes.length}`);
  console.log(`  Bucket B (regressions vs new judge): ${bucketB_regressionsVsNew.length}`);
}

main();
