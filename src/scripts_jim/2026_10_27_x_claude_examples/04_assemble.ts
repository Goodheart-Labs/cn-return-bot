/**
 * Step 4 of the X Claude examples (GOO-527, GOO-614): write docs/x-note-examples.md,
 * the file every X Claude gets appended to its system prompt.
 *
 * The examples are sorted by the time their note was written, oldest first
 * (Jim, 2026-10-27). The file is laid out so that a person can read it too
 * (Jim, 2026-10-28). Each line of the input becomes a list entry or a quote,
 * because rendered Markdown would otherwise run the lines together.
 *
 *   bun run src/scripts_jim/2026_10_27_x_claude_examples/04_assemble.ts
 */

import { readFileSync, writeFileSync } from "fs";
import * as path from "path";

const HERE = import.meta.dir;
const OUT_PATH = path.resolve(HERE, "../../../docs/x-note-examples.md");
const TOP_REASONS = 3;
/** The input's own headings ("## Post", "### Video 1") sit under the
 *  example's "### What the note writer saw", so they move two levels down. */
const INPUT_HEADING_SHIFT = "##";
/** Sections of the input whose lines are the post's own words. */
const QUOTED_SECTIONS = new Set(["Post", "Post (retweet)", "Quoted post"]);
const FIELD_LINE = /^[A-Z][A-Za-z ]*: /;

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
const statusWords = (status: string) => STATUS_WORDS[status] ?? status;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join("\n>\n");
}

/** Turns the input as Claude sees it into Markdown that renders line by line. */
function readableInput(input: string): string {
  const out: string[] = [];
  let quoted: string[] | null = null;
  const closeQuote = () => {
    if (quoted) out.push(quote(quoted.join("\n")), "");
    quoted = null;
  };
  for (const line of input.split("\n")) {
    const heading = line.match(/^#+ (.*)$/);
    if (heading) {
      closeQuote();
      out.push(`${INPUT_HEADING_SHIFT}${line}`, "");
      if (QUOTED_SECTIONS.has(heading[1]!)) quoted = [];
    } else if (quoted) quoted.push(line);
    else if (FIELD_LINE.test(line)) out.push(`- ${line}`);
    else if (line.trim()) out.push(line, "");
    else if (out.at(-1) !== "") out.push("");
  }
  closeQuote();
  return out.join("\n").trim();
}

function topReasons(reasons: Record<string, number>): string {
  const words = (tag: string) => tag.replace(/^(notHelpful|helpful)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_REASONS)
    .map(([tag, count]) => `${words(tag)} (${count})`)
    .join(", ");
}

const ratingCounts = (r: Ratings) => `${r.helpful} Helpful, ${r.somewhat_helpful} Somewhat helpful, ${r.not_helpful} Not helpful`;

function verdict(example: Example, ratings: Ratings | undefined): string {
  const lines = [`- The note was ${statusWords(example.status)}.`];
  if (ratings) {
    lines.push(`- Ratings: ${ratingCounts(ratings)}.`);
    const helpful = topReasons(ratings.helpful_reasons);
    const notHelpful = topReasons(ratings.not_helpful_reasons);
    if (helpful) lines.push(`- Top reasons for Helpful: ${helpful}.`);
    if (notHelpful) lines.push(`- Top reasons for Not helpful: ${notHelpful}.`);
  }
  if (example.not_needed_notes.length) {
    lines.push("", "Other contributors wrote on this post that no note was needed:", "");
    for (const n of example.not_needed_notes) lines.push(`- (${statusWords(n.status)}) ${n.text.replace(/\s+/g, " ").trim()}`);
  }
  return lines.join("\n");
}

function render(example: Example, index: number, ratings: Ratings | undefined): string {
  return [
    `## Example ${index + 1}: ${statusWords(example.status)}`,
    `The note was written on ${day(example.created_at_ms)}.`,
    "### What the note writer saw",
    readableInput(example.input),
    "### The note",
    quote(example.text),
    "### Verdict",
    verdict(example, ratings),
  ].join("\n\n");
}

function overview(examples: Example[], ratings: Record<string, Ratings>): string {
  const rows = examples.map((e, i) => {
    const r = ratings[e.note_id];
    return `| ${i + 1} | ${day(e.created_at_ms)} | ${statusWords(e.status)} | ${r ? `${r.helpful} / ${r.somewhat_helpful} / ${r.not_helpful}` : "—"} | ${e.not_needed_notes.length || ""} |`;
  });
  return ["| Example | Note written | Verdict | Helpful / Somewhat / Not helpful | Note-not-needed notes |", "|---|---|---|---|---|", ...rows].join("\n");
}

const examples: Example[] = readFileSync(path.join(HERE, "examples.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const ratings: Record<string, Ratings> = JSON.parse(readFileSync(path.join(HERE, "ratings.json"), "utf8"));
examples.sort((a, b) => a.created_at_ms - b.created_at_ms);
const helpfulCount = examples.filter((e) => e.status === "CURRENTLY_RATED_HELPFUL").length;

const intro = `# X note examples

These are ${examples.length} Community Notes from the last six months, written by many contributors on posts they found misleading, with the verdict raters gave each one. ${helpfulCount} were rated helpful and ${examples.length - helpfulCount} were rated not helpful. They are sorted by the time the note was written.

Each example has three parts:

- **What the note writer saw** is the post as our pipeline shows it to a note writer, as of the moment the note was written: the author, the engagement, the post's text and descriptions of its images and videos.
- **The note** is the note as its author wrote it.
- **Verdict** is how raters judged the note: its final status, how many raters found it helpful, somewhat helpful or not helpful, and the reasons they picked most often. For a note rated not helpful, it also lists the notes other contributors wrote to say the post needed no note.

${overview(examples, ratings)}`;

writeFileSync(OUT_PATH, [intro, ...examples.map((e, i) => render(e, i, ratings[e.note_id]))].join("\n\n---\n\n") + "\n");
console.log(`Wrote ${examples.length} examples to ${OUT_PATH}`);
