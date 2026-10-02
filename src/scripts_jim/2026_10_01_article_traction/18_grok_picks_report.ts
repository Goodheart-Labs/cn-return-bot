/**
 * Writes every post Grok picked in experiments 14 and 16 into one Markdown file,
 * data/grok_picks.md, so Jim can open the links and judge whether they are good
 * picks. No API calls. The file stays in the gitignored data folder because it
 * quotes other people's posts.
 */
import { readFileSync, writeFileSync } from "fs";

const DATA = `${import.meta.dir}/data`;
const runs = [
  ...JSON.parse(readFileSync(`${DATA}/14_summary.json`, "utf8")).map((r: any) => ({ ...r, title: `Per crowd (grok-4.7): ${r.key}` })),
  ...JSON.parse(readFileSync(`${DATA}/16_summary.json`, "utf8")).map((r: any) => ({ ...r, title: `"Nathan Young's crowd" prompt: ${r.key}` })),
];

const lines = ["# Grok's viral picks, 2026-10-02", ""];
for (const run of runs) {
  lines.push(`## ${run.title} ($${run.costUsd.toFixed(2)})`, "");
  for (const p of run.posts) {
    const article = p.linked_article_url ? ` Article: ${p.linked_article_url}` : "";
    lines.push(`- ${p.post_url} (${p.likes} likes, ${p.quotes} quotes). ${p.summary}${article}`);
  }
  lines.push("");
}
writeFileSync(`${DATA}/grok_picks.md`, lines.join("\n"));
console.log(`wrote ${runs.reduce((n, r) => n + r.posts.length, 0)} picks`);
