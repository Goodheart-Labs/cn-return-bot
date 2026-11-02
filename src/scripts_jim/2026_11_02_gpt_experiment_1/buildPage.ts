/* Builds the results page of experiment 1 (GOO-687) from the ground truth,
 * the four GPT runs and Claude's judgements, into out/page.html.
 *
 * judgements.json holds, per post, a one-line summary, the judgement of every
 * note rated helpful on the site (found, partly or no, with the GPT drafts that
 * match it) and the verdict on every GPT note (found, good, unsure or bad). A
 * GPT draft is named by its position in the run's drafts.json. */

import { readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { POSTS } from "./posts";

const DIR = import.meta.dir;
const OUT = path.join(DIR, "out");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

type Found = "yes" | "partly" | "no";
type Verdict = "found" | "good" | "unsure" | "bad";
interface PostJudgement {
  short: string;
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

const groundTruth = read(path.join(OUT, "ground-truth.json"));
const judgements: Record<string, PostJudgement> = read(path.join(DIR, "judgements.json"));
const settings = read(path.join(OUT, "runs", POSTS[0]!.slug, "job.json")).settings;

const posts = POSTS.map(({ slug }) => {
  const truth = groundTruth.find((p: { slug: string }) => p.slug === slug);
  const judgement = judgements[slug]!;
  const drafts = read(path.join(OUT, "runs", slug, "drafts.json"));
  const run = read(path.join(OUT, "runs", slug, "summary.json"));
  const text: string = truth.fullText;
  const claudeCosts = truth.claudeRuns.map((r: { api_cost_usd: number | null }) => r.api_cost_usd).filter((c: number | null) => c !== null);
  return {
    slug,
    short: judgement.short,
    summary: judgement.summary,
    title: truth.title,
    url: truth.url,
    text,
    run,
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
        ...(judgement.existing[n.id as string] ?? {}),
      })),
    gpt: drafts.map((d: Record<string, unknown>, i: number) => ({
      id: String(i),
      ...d,
      ...locate(text, d.passage as string),
      ...(judgement.gpt[String(i)] ?? {}),
    })),
  };
});

const data = {
  lede: "GPT-6.1 Terra ran in the new harness on four posts that already had notes. Claude then judged which of the notes rated helpful on the site GPT also found, and whether each of GPT's other notes is good, unsure or bad.",
  settings: [`reasoning ${settings.effort}`, `${settings.tier === "default" ? "standard" : settings.tier} tier`, `through ${settings.provider}`, "with Jim's thoughts on good notes", `run on ${new Date().toISOString().slice(0, 10)}`],
  tableNotes: read(path.join(DIR, "tableNotes.json")),
  posts,
};
const page = readFileSync(path.join(DIR, "page.html"), "utf8").replace("/*DATA*/", JSON.stringify(data).replaceAll("</", "<\\/"));
writeFileSync(path.join(OUT, "page.html"), page);
console.log(`Wrote ${path.join(OUT, "page.html")} (${Math.round(page.length / 1024)} KB)`);
