/* Builds the results page of experiment 1 (GOO-687) from the ground truth,
 * the GPT runs at each reasoning effort and Claude's judgements, into
 * out/page.html.
 *
 * A post's judgements file holds a short summary, the judgement of every note
 * rated helpful on the site (found, partly or no, with the GPT drafts that
 * match it) and the verdict on every GPT note (found, good, unsure or bad). A
 * GPT draft is named by its position in the run's drafts.json. */

import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { WEB_SEARCH_CALL_USD } from "../../gpt-notes/pricing";
import { POSTS } from "./posts";

const DIR = import.meta.dir;
const OUT = path.join(DIR, "out");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

type Found = "yes" | "partly" | "no";
type Verdict = "found" | "good" | "unsure" | "bad";
interface PostJudgement {
  summary: string;
  existing: Record<string, { found: Found; gpt: number[]; comment: string }>;
  gpt: Record<string, { verdict: Verdict; comment: string }>;
}

/** Curly quotes, dashes and runs of white space differ between the stored text
 *  and the quotes, so both are compared in a plain form. The map gives each
 *  plain character's position in the original text. */
function plainForm(text: string): { plain: string; positions: number[] } {
  let plain = "";
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let ch = text[i]!.replace(/[‘’]/, "'").replace(/[“”]/, '"').replace(/[–—]/, "-");
    if (/\s/.test(ch)) {
      if (plain.endsWith(" ")) continue;
      ch = " ";
    }
    plain += ch;
    positions.push(i);
  }
  return { plain, positions };
}

function locate(text: string, passage: string | null): { start: number | null; end: number | null } {
  if (!passage) return { start: null, end: null };
  const exact = text.indexOf(passage);
  if (exact >= 0) return { start: exact, end: exact + passage.length };
  const haystack = plainForm(text);
  const needle = plainForm(passage.trim()).plain;
  const at = haystack.plain.indexOf(needle);
  if (at < 0) return { start: null, end: null };
  return { start: haystack.positions[at]!, end: haystack.positions[at + needle.length - 1]! + 1 };
}

/** The runs at each reasoning effort, all on the standard tier. A run's
 *  folder holds its drafts and summary, and its judgements folder Claude's
 *  verdicts on them. */
const EFFORTS = [
  { key: "xhigh", runs: "runs", judgements: "judgements" },
  { key: "medium", runs: "runs/medium", judgements: "judgements/medium" },
];

/** Flex halves every token price, but each web search costs the same on
 *  every tier. The estimate assumes flex would serve every request. */
function flexEstimateUsd(run: { costUsd: number; webSearches: number }): number {
  const searchesUsd = run.webSearches * WEB_SEARCH_CALL_USD;
  return (run.costUsd - searchesUsd) / 2 + searchesUsd;
}

const TABLE_NOTES = [
  "A note rated helpful counts as found when one of GPT's notes makes the same main point. Partly means GPT's note touches the issue but misses the main point.",
  "Claude judged each of GPT's other notes: good means correct and helpful to most readers, bad means wrong, a misreading of the author, pedantic or unnecessary. When a medium note made the same point as an xhigh note, its judge started from the xhigh verdict, so the two runs are graded alike.",
  "The examples in GPT's system prompt contained some of the notes on the Pinker and sex cult posts. For those two posts GPT got the examples without any note on the same post, so it could not copy the answers.",
  "The notes on the sex cult post were written on its September version. The author later published a longer revised version that lacks most of the noted passages, so GPT read the September text.",
  "GPT cost is what OpenRouter billed on the standard tier, including $0.01 per web search. The flex estimate halves the token part of that cost and keeps the searches, which cost the same on every tier. It assumes flex serves every request. In practice OpenAI sometimes turns flex requests away, and the harness then retries them on the standard tier.",
  "Claude Code cost is what Claude Code reports the same run would have cost on the API. It is recorded only since late October, so only one post has it.",
];

const groundTruth = read(path.join(OUT, "ground-truth.json"));

function runAt(effort: (typeof EFFORTS)[number], slug: string, text: string) {
  const judgement: PostJudgement = read(path.join(OUT, effort.judgements, `${slug}.json`));
  const drafts = read(path.join(OUT, effort.runs, slug, "drafts.json"));
  const run = read(path.join(OUT, effort.runs, slug, "summary.json"));
  return {
    summary: judgement.summary,
    run: { ...run, flexCostUsd: flexEstimateUsd(run) },
    found: judgement.existing,
    gpt: drafts.map((d: Record<string, unknown>, i: number) => ({
      id: String(i),
      ...d,
      ...locate(text, d.passage as string),
      ...(judgement.gpt[String(i)] ?? {}),
    })),
  };
}

const posts = POSTS.map(({ slug, short }) => {
  const truth = groundTruth.find((p: { slug: string }) => p.slug === slug);
  const text: string = truth.fullText;
  const claudeCosts = truth.claudeRuns.map((r: { api_cost_usd: number | null }) => r.api_cost_usd).filter((c: number | null) => c !== null);
  return {
    slug,
    short,
    title: truth.title,
    url: truth.url,
    text,
    claudeCostUsd: claudeCosts.length ? claudeCosts.reduce((a: number, b: number) => a + b, 0) : null,
    existing: truth.notes.map((n: Record<string, unknown>) => ({
      id: n.id,
      writer: n.writer,
      author: n.author_name,
      rating: n.rating,
      counts: { h: n.helpful_count, s: n.somewhat_helpful_count, n: n.not_helpful_count },
      passage: n.passage,
      note: n.note,
      ...locate(text, n.passage as string | null),
    })),
    runs: Object.fromEntries(EFFORTS.map((effort) => [effort.key, runAt(effort, slug, text)])),
  };
});

const data = {
  lede: "GPT-6.1 Terra ran in the new harness on four posts that already had notes, once at xhigh and once at medium reasoning effort. Claude then judged which of the notes rated helpful on the site GPT also found, and whether each of GPT's other notes is good, unsure or bad.",
  settings: ["standard tier", "through OpenRouter", "with Jim's thoughts on good notes", "run on 2 Nov 2026"],
  efforts: EFFORTS.map((effort) => effort.key),
  tableNotes: TABLE_NOTES,
  posts,
};
const page = readFileSync(path.join(DIR, "page.html"), "utf8").replace("/*DATA*/", JSON.stringify(data).replaceAll("</", "<\\/"));
writeFileSync(path.join(OUT, "page.html"), page);
console.log(`Wrote ${path.join(OUT, "page.html")} (${Math.round(page.length / 1024)} KB)`);
