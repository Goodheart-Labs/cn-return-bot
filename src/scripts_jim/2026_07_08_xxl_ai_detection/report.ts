/**
 * Turn the classified posts into a summary report: the share that Pangram calls
 * fully AI-generated, plus a table (link · views · recency) of every AI post.
 *
 * Writes report.md + ai_posts.jsonl + summary.json to OUT_DIR, mirrors the
 * markdown into the GitHub Actions step summary, and logs the headline numbers.
 */
import fs from "fs";
import path from "path";
import type { Post } from "../../api/fetchEligiblePosts";
import { ageInHours, formatCount } from "../../pipeline/orchestration/utils/tweetSorting";
import { isFullyAiGenerated, type PangramVerdict } from "./pangramClient";

export type AnalyzedPost = { post: Post; verdict: PangramVerdict };

type AiRow = {
  url: string;
  views: number;
  created_at: string;
  age_hours: number;
  fraction_ai: number;
  pangram_link: string;
};

type Stats = {
  feedSize: string;
  totalFetched: number;
  longFormCount: number;
  analyzedCount: number;
  classifiedCount: number;
  errorCount: number;
  aiCount: number;
  pctOfClassified: number;
};

function toAiRow({ post, verdict }: AnalyzedPost): AiRow {
  return {
    url: `https://x.com/i/status/${post.id}`,
    views: post.public_metrics?.impression_count ?? 0,
    created_at: post.created_at,
    age_hours: Math.round(ageInHours(post) * 10) / 10,
    fraction_ai: verdict.type === "classified" ? verdict.fractionAi : 0,
    pangram_link: verdict.type === "classified" ? verdict.dashboardLink : "",
  };
}

export type ReportInputs = {
  feedSize: string;
  totalFetched: number;
  longFormCount: number;
  analyzed: AnalyzedPost[];
  outDir: string;
};

export function buildReport(inputs: ReportInputs): void {
  const { feedSize, totalFetched, longFormCount, analyzed, outDir } = inputs;

  const classifiedCount = analyzed.filter((a) => a.verdict.type === "classified").length;
  const aiPosts = analyzed.filter((a) => isFullyAiGenerated(a.verdict));
  const aiRows = aiPosts.map(toAiRow).sort((a, b) => b.views - a.views); // most-viewed AI posts first

  const stats: Stats = {
    feedSize,
    totalFetched,
    longFormCount,
    analyzedCount: analyzed.length,
    classifiedCount,
    errorCount: analyzed.length - classifiedCount,
    aiCount: aiPosts.length,
    pctOfClassified: classifiedCount > 0 ? (aiPosts.length / classifiedCount) * 100 : 0,
  };

  const md = renderMarkdown(stats, aiRows);
  writeArtifacts(outDir, md, aiRows, stats);
  appendStepSummary(md);

  console.log(
    `\n[report] ${stats.aiCount}/${stats.classifiedCount} analyzed long-form posts are fully AI-generated ` +
      `(${stats.pctOfClassified.toFixed(1)}%); ${stats.errorCount} classification errors.`
  );
}

function renderMarkdown(s: Stats, aiRows: AiRow[]): string {
  const lines = [
    `# AI-generated long-form posts — \`${s.feedSize}\` feed`,
    ``,
    `- **Posts fetched:** ${s.totalFetched}`,
    `- **Long-form (paid/premium) posts:** ${s.longFormCount}`,
    `- **Analyzed with Pangram:** ${s.analyzedCount} (${s.classifiedCount} classified, ${s.errorCount} errors)`,
    `- **Fully AI-generated:** ${s.aiCount} → **${s.pctOfClassified.toFixed(1)}%** of classified`,
    ``,
    `## AI-generated posts (${aiRows.length})`,
    ``,
    `| # | Link | Views | Age (h) | Posted | fraction_ai | Pangram report |`,
    `| - | ---- | ----: | ------: | ------ | ----------: | -------------- |`,
    ...aiRows.map(
      (r, i) =>
        `| ${i + 1} | ${r.url} | ${formatCount(r.views)} | ${r.age_hours} | ${r.created_at ?? "?"} | ${r.fraction_ai.toFixed(2)} | ${r.pangram_link} |`
    ),
  ];
  return lines.join("\n") + "\n";
}

function writeArtifacts(outDir: string, md: string, aiRows: AiRow[], stats: Stats): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.md"), md);
  fs.writeFileSync(path.join(outDir, "ai_posts.jsonl"), aiRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify({ ...stats, pctOfClassified: Math.round(stats.pctOfClassified * 10) / 10, fetchedAt: new Date().toISOString() }, null, 2)
  );
}

function appendStepSummary(md: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) fs.appendFileSync(summaryPath, md);
}
