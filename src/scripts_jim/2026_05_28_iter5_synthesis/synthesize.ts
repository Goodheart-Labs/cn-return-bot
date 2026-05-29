/**
 * Read all 44 per-row analyses, dispatch ONE Sonnet call to cluster them into
 * 5-8 themes with prioritized fix proposals. Output: iter-5 proposal doc.
 */
import "dotenv/config";
import * as fs from "fs";
import { llm } from "../../pipeline/llm/llm";

const SONNET = "anthropic/claude-sonnet-4-6";
const IN = "src/scripts_jim/2026_05_28_iter5_synthesis/per_row_analysis.json";
const OUT = "src/scripts_jim/2026_05_28_iter5_synthesis/iter5_proposal.md";

interface PerRowReport {
  root_cause_stage: string;
  specific_issue: string;
  fix_proposal: string;
  fix_target: string;
  priority: string;
  generalizes_to_other_rows: boolean;
  reasoning: string;
}

interface RowAnalysis {
  bucket: string;
  url: string;
  needs_note: string;
  writer_proposed_note: string;
  report: PerRowReport | null;
}

const PROMPT_HEADER = `You are synthesizing 44 per-row failure analyses from a Community Notes pipeline iteration (iter-4 on val.csv). Each row was failed in a specific bucket, and a per-row subagent proposed a concrete fix. Your job: cluster these proposals into 5-8 distinct themes and produce a prioritized iter-5 proposal.

## Context

The pipeline has 4 stages: search (returns evidence) → writer (composes note) → judge (passes/rejects) → verifier (checks sources). Iter-4 metrics: 56% PASS, 6% FP rate. The user prioritizes low FP rate over high PASS rate.

Aggregate from per-row analyses:
- 26/44 failures attributed to writer (writer_prompt)
- 14/44 failures attributed to search (13 search_query_writer, 1 search_infra)
- 4/44 failures attributed to judge (judge_prompt)

## Your task

Cluster the per-row fix proposals into 5-8 THEMES. For each theme:
- theme_name (short)
- affected_rows_count
- affected_buckets (which v2 buckets it shows up in)
- root_pattern (1-2 sentences describing the common failure mode)
- specific_fix (concrete prompt edit or structural change — quote text where the per-row reports gave specific language; combine into one coherent prescription)
- estimated_pass_delta (how many rows this would recover if perfectly applied)
- estimated_fp_delta (could this INTRODUCE FPs?)
- confidence (high/medium/low — is the fix obvious or speculative)

Then output an overall iter-5 hill-climbing recommendation: which 2-3 themes to implement first, in what order, and what to test on the replay before running val.

Be concrete. Don't hedge. If a theme is "improve the writer prompt" — say WHICH bullet point to add.

Output format: a markdown document with these sections:
1. # Executive Summary (3-5 sentences: what's the iter-4 failure profile, what should iter-5 fix)
2. ## Themes (one ### section per theme, with the fields above)
3. ## iter-5 Recommendation (which themes to implement first, ordered, with replay test plan)
4. ## Out of scope (themes deferred to iter-6+)

## All 44 per-row reports (bucket × root cause stage × fix target × specific issue → proposed fix):

`;

async function main() {
  const data: RowAnalysis[] = JSON.parse(fs.readFileSync(IN, "utf8"));
  const lines: string[] = [];
  for (const a of data) {
    if (!a.report) continue;
    lines.push(`- [${a.bucket}] writer note: "${(a.writer_proposed_note || "(empty)").slice(0, 150)}"`);
    lines.push(`  root_cause=${a.report.root_cause_stage} fix_target=${a.report.fix_target} priority=${a.report.priority}`);
    lines.push(`  issue: ${a.report.specific_issue}`);
    lines.push(`  fix: ${a.report.fix_proposal}`);
    lines.push(``);
  }
  const prompt = PROMPT_HEADER + lines.join("\n");

  console.log(`Sending ${lines.length / 5} reports to Sonnet for synthesis (prompt length ${prompt.length} chars)...`);
  const resp = await llm.create({
    model: SONNET,
    temperature: 1,
    messages: [{ role: "user", content: prompt }],
    // @ts-expect-error openrouter extended thinking
    reasoning: { effort: "medium" },
  } as any);

  const content = resp.choices?.[0]?.message?.content ?? "";
  fs.writeFileSync(OUT, content);
  console.log(`\nWrote ${OUT}`);
  console.log(`\n=== Preview (first 3000 chars) ===\n${content.slice(0, 3000)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
