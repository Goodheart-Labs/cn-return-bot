/**
 * Step 4 of the X Claude examples (GOO-527, GOO-614): write docs/x-note-examples.md,
 * the file every X Claude gets appended to its system prompt.
 *
 * The examples are sorted by the time their note was written, oldest first
 * (Jim, 2026-10-27).
 *
 *   bun run src/scripts_jim/2026_10_27_x_claude_examples/04_assemble.ts
 */

import { readFileSync, writeFileSync } from "fs";
import * as path from "path";

const HERE = import.meta.dir;
const OUT_PATH = path.resolve(HERE, "../../../docs/x-note-examples.md");
const TOP_REASONS = 3;

interface Example {
  note_id: string;
  created_at_ms: number;
  text: string;
  status: string;
  input: string;
  not_needed_notes: { text: string; status: string }[];
}

interface Ratings {
  helpful: number;
  somewhat_helpful: number;
  not_helpful: number;
  helpful_reasons: Record<string, number>;
  not_helpful_reasons: Record<string, number>;
}

const STATUS_WORDS: Record<string, string> = {
  CURRENTLY_RATED_HELPFUL: "rated helpful",
  CURRENTLY_RATED_NOT_HELPFUL: "rated not helpful",
  NEEDS_MORE_RATINGS: "needs more ratings",
};

/** "notHelpfulSourcesMissingOrUnreliable" becomes "sources missing or unreliable". */
function reasonWords(tag: string): string {
  return tag.replace(/^(notHelpful|helpful)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
}

function topReasons(reasons: Record<string, number>): string {
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_REASONS)
    .map(([tag, count]) => `${reasonWords(tag)} (${count})`)
    .join(", ");
}

function verdict(example: Example, ratings: Ratings | undefined): string {
  const lines = [`The note was ${STATUS_WORDS[example.status] ?? example.status}.`];
  if (ratings) {
    lines.push(`Ratings: ${ratings.helpful} Helpful, ${ratings.somewhat_helpful} Somewhat helpful, ${ratings.not_helpful} Not helpful.`);
    const helpful = topReasons(ratings.helpful_reasons);
    const notHelpful = topReasons(ratings.not_helpful_reasons);
    if (helpful) lines.push(`Top reasons for Helpful: ${helpful}.`);
    if (notHelpful) lines.push(`Top reasons for Not helpful: ${notHelpful}.`);
  }
  if (example.not_needed_notes.length) {
    lines.push("", "Other contributors wrote on this post that no note was needed:");
    for (const n of example.not_needed_notes) lines.push(`- (${STATUS_WORDS[n.status] ?? n.status}) ${n.text}`);
  }
  return lines.join("\n");
}

function render(example: Example, index: number, ratings: Ratings | undefined): string {
  const day = new Date(example.created_at_ms).toISOString().slice(0, 10);
  return [`# Example ${index + 1}, note written ${day}`, "", example.input, "", "## The note", "", example.text, "", "## Verdict", "", verdict(example, ratings)].join("\n");
}

const examples: Example[] = readFileSync(path.join(HERE, "examples.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const ratings: Record<string, Ratings> = JSON.parse(readFileSync(path.join(HERE, "ratings.json"), "utf8"));
examples.sort((a, b) => a.created_at_ms - b.created_at_ms);

const intro = `These are ${examples.length} Community Notes from the last six months, written by many contributors, with the verdict raters gave each one. Each example shows the input as you would see it, then the note, then the verdict.`;
writeFileSync(OUT_PATH, [intro, ...examples.map((e, i) => render(e, i, ratings[e.note_id]))].join("\n\n---\n\n") + "\n");
console.log(`Wrote ${examples.length} examples to ${OUT_PATH}`);
