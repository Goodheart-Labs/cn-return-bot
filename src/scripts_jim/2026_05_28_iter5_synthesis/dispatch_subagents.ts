/**
 * Dispatch Sonnet calls on every iter-4 failure case (V2 buckets) to produce
 * a structured root-cause + fix-proposal record per row.
 *
 * Failure buckets analyzed:
 *   - nw_published_bad        (10) writer wrote bad note, pipeline let it pass
 *   - nw_miss_judge_killed_bad (15) writer wrote bad note, judge caught it
 *   - nw_miss_judge_killed_good (2) judge rejected a good note
 *   - nw_miss_search_exhausted (14) search infra failed
 *   - nnw_fp_published         (3) full-pipeline FP
 *
 * Total ~44 Sonnet calls, ~$1.50.
 *
 * Output: src/scripts_jim/2026_05_28_iter5_synthesis/per_row_analysis.json
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { llm } from "../../pipeline/llm/llm";

const SONNET = "anthropic/claude-sonnet-4-6";
const V2_DIR = "dataset_runs/tryout-iter-04-cheap-bot-merged/_v2";
const OUT = "src/scripts_jim/2026_05_28_iter5_synthesis/per_row_analysis.json";

const BUCKETS = [
  "nw_published_bad",
  "nw_miss_judge_killed_bad",
  "nw_miss_judge_killed_good",
  "nw_miss_search_exhausted",
  "nnw_fp_published",
];

interface SubagentReport {
  root_cause_stage: "writer" | "judge" | "search" | "verifier" | "annotation_disagreement";
  specific_issue: string;
  fix_proposal: string;
  fix_target: "writer_prompt" | "judge_prompt" | "search_query_writer" | "search_infra" | "verifier_prompt" | "verifier_fetch" | "structural_change" | "annotation";
  priority: "high" | "medium" | "low";
  generalizes_to_other_rows: boolean;
  reasoning: string;
}

interface RowAnalysis {
  bucket: string;
  url: string;
  needs_note: string;
  judge_guidance: string;
  ground_truth_note: string;
  tweet_text: string;
  writer_proposed_note: string;
  writer_sources: string[];
  judge_reasoning: string;
  ai_judge_on_proposed_verdict: { correct: boolean; reason?: string } | null;
  ai_judge_on_published_verdict: { correct: boolean; reason?: string } | null;
  stage_block: string;
  report: SubagentReport | null;
}

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "subagent_report",
    strict: true,
    schema: {
      type: "object",
      properties: {
        root_cause_stage: { type: "string", enum: ["writer", "judge", "search", "verifier", "annotation_disagreement"] },
        specific_issue: { type: "string", description: "1-2 sentences naming the concrete failure mode in this row." },
        fix_proposal: { type: "string", description: "Specific actionable change (prompt edit text, structural change, etc.). Be concrete." },
        fix_target: { type: "string", enum: ["writer_prompt", "judge_prompt", "search_query_writer", "search_infra", "verifier_prompt", "verifier_fetch", "structural_change", "annotation"] },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        generalizes_to_other_rows: { type: "boolean", description: "Does this fix help a pattern of similar failures, or is it a one-off?" },
        reasoning: { type: "string", description: "Why this is the root cause, citing specific phrases from judge_guidance or the writer's note." },
      },
      required: ["root_cause_stage", "specific_issue", "fix_proposal", "fix_target", "priority", "generalizes_to_other_rows", "reasoning"],
      additionalProperties: false,
    },
  },
};

function buildPrompt(row: any, bucket: string): string {
  const writer = row._v2_proposed_note ?? "";
  const proposedVerdict = row._v2_proposed_note_verdict;
  const publishedVerdict = row._v2_published_note_verdict;
  const logs = row.logs ?? {};
  const judgeReasoning = logs?.simpleBot?.judge?.messages?.["1"]?.content?.reasoning
    ?? logs?.simpleBot?.judge?.messages?.[1]?.content?.reasoning
    ?? "";

  return [
    `You are analyzing a single Community Notes pipeline failure. Decide the root cause and propose a concrete fix.`,
    ``,
    `## Pipeline overview`,
    `Stages: (1) search → (2) writer composes a note → (3) note-needed judge passes/rejects → (4) source verifier passes/rejects. The note is published only if all gates pass. Each stage can fail.`,
    ``,
    `## This row's bucket`,
    `**${bucket}** — ${BUCKET_DESCRIPTIONS[bucket as keyof typeof BUCKET_DESCRIPTIONS]}`,
    `Pipeline stage that gated this row: ${row._v2_stage_block}`,
    ``,
    `## Ground truth`,
    `needs_note = ${row.needs_note}`,
    `Ground truth note (example of a good note for this tweet, if applicable):`,
    row.ground_truth_note || "(none)",
    ``,
    `## Judge guidance (the strict criteria a PASSING note must meet for this tweet)`,
    row.judge_guidance || "(none)",
    row.original_note_text ? `\n## A PRIOR note on this tweet was rated NOT HELPFUL${row.failure_reason ? ` (${row.failure_reason})` : ""}: "${row.original_note_text}"` : "",
    ``,
    `## Tweet text`,
    row.text ?? "",
    ``,
    `## Writer's proposed note (may have been blocked by judge/verifier)`,
    writer ? `Note: "${writer}"` : "(writer returned empty / never invoked)",
    ``,
    `## AI judge on writer's PROPOSED note (against ground truth)`,
    proposedVerdict ? `tier=${proposedVerdict.tier}  reason: ${proposedVerdict.reason ?? ""}` : "(not judged)",
    ``,
    `## Iter-4 pipeline judge (note-needed judge) reasoning`,
    judgeReasoning || "(no judge log)",
    ``,
    `## Your task`,
    `1. Decide root_cause_stage: which stage is primarily responsible for this row's failure?`,
    `   - "writer" if the writer's note was bad, missed the key dispute, or hallucinated`,
    `   - "judge" if the writer's note actually meets the judge_guidance but the judge wrongly rejected/passed`,
    `   - "search" if findings didn't contain the evidence needed (and queries weren't pathological — those'd be search_query_writer)`,
    `   - "verifier" if the source verifier killed a good note or accepted a bad source`,
    `   - "annotation_disagreement" only when the AI judge clearly disagrees with the ground_truth annotation`,
    `2. specific_issue: 1-2 sentences naming the concrete failure mode.`,
    `3. fix_proposal: A SPECIFIC actionable change. Don't say "improve the writer prompt" — say what text to add/remove/change, or what structural change to make.`,
    `4. fix_target: which stage's code/prompt the fix lives in.`,
    `5. priority: high if this pattern likely affects 5+ other rows; medium if a few; low if one-off.`,
    `6. generalizes_to_other_rows: true if the fix likely helps similar rows, false if it's bespoke.`,
    `7. reasoning: 2-3 sentences citing specific judge_guidance text or specific note phrases.`,
    ``,
    `Return JSON matching the schema.`,
  ].join("\n");
}

const BUCKET_DESCRIPTIONS = {
  nw_published_bad: "Ground truth says note needed, pipeline published a note, but AI judge rates the note as bad. Pipeline let a sub-standard note through.",
  nw_miss_judge_killed_bad: "Ground truth says note needed, writer produced a note, judge rejected it, AI judge confirms the writer's note WAS bad. So the iter-4 judge correctly rejected — the failure is on the writer side.",
  nw_miss_judge_killed_good: "Ground truth says note needed, writer produced a note, judge rejected it, AI judge rates the note as GOOD. Pure judge mistake.",
  nw_miss_search_exhausted: "Ground truth says note needed, search returned no usable findings, writer never invoked. Search / query / infra problem.",
  nnw_fp_published: "Ground truth says NO note should exist, but pipeline published one. Writer + judge + verifier all failed to catch.",
};

async function classify(row: any, bucket: string): Promise<SubagentReport> {
  const resp = await llm.create({
    model: SONNET,
    temperature: 1,
    messages: [{ role: "user", content: buildPrompt(row, bucket) }],
    response_format: SCHEMA,
    // @ts-expect-error openrouter extended thinking
    reasoning: { effort: "low" },
  } as any);
  const content = resp.choices?.[0]?.message?.content ?? "";
  return JSON.parse(content) as SubagentReport;
}

async function main() {
  const allAnalyses: RowAnalysis[] = [];
  let totalCount = 0;
  for (const bucket of BUCKETS) {
    const file = path.join(V2_DIR, `${bucket}.json`);
    if (!fs.existsSync(file)) { console.log(`(skip ${bucket}: no file)`); continue; }
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(`\n=== ${bucket} (${rows.length} rows) ===`);
    for (let i = 0; i < rows.length; i++) {
      totalCount++;
      const r = rows[i];
      const analysis: RowAnalysis = {
        bucket,
        url: r.url ?? "",
        needs_note: r.needs_note ?? "",
        judge_guidance: r.judge_guidance ?? "",
        ground_truth_note: r.ground_truth_note ?? "",
        tweet_text: r.text ?? "",
        writer_proposed_note: r._v2_proposed_note ?? "",
        writer_sources: Array.isArray(r.logs?.simpleBot?.writer?.attempts?.["0"]?.response?.sources)
          ? r.logs.simpleBot.writer.attempts["0"].response.sources
          : [],
        judge_reasoning: r.logs?.simpleBot?.judge?.messages?.["1"]?.content?.reasoning
          ?? r.logs?.simpleBot?.judge?.messages?.[1]?.content?.reasoning
          ?? "",
        ai_judge_on_proposed_verdict: r._v2_proposed_note_verdict ?? null,
        ai_judge_on_published_verdict: r._v2_published_note_verdict ?? null,
        stage_block: r._v2_stage_block ?? "",
        report: null,
      };
      try {
        analysis.report = await classify(r, bucket);
        console.log(`  [${i + 1}/${rows.length}] ${r.url?.replace(/^.*status\//, "")}  → ${analysis.report.root_cause_stage}/${analysis.report.fix_target} (${analysis.report.priority})`);
      } catch (err: any) {
        console.log(`  [${i + 1}/${rows.length}] ERR: ${err?.message}`);
      }
      allAnalyses.push(analysis);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(allAnalyses, null, 2));
  console.log(`\nTotal analyzed: ${totalCount} rows → ${OUT}`);

  // Quick aggregate
  const byCause: Record<string, number> = {};
  const byFixTarget: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const a of allAnalyses) {
    if (!a.report) continue;
    byCause[a.report.root_cause_stage] = (byCause[a.report.root_cause_stage] ?? 0) + 1;
    byFixTarget[a.report.fix_target] = (byFixTarget[a.report.fix_target] ?? 0) + 1;
    byPriority[a.report.priority] = (byPriority[a.report.priority] ?? 0) + 1;
  }
  console.log("\nRoot cause:");
  for (const [k, v] of Object.entries(byCause).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`);
  console.log("\nFix target:");
  for (const [k, v] of Object.entries(byFixTarget).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`);
  console.log("\nPriority:");
  for (const [k, v] of Object.entries(byPriority).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
