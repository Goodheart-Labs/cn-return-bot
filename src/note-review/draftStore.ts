/* Reads and writes the note-finding agents' drafts and the review log
 * (GOO-504). The dashboard's server and Claude's command-line tools share it,
 * so both keep the same history. */

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { ENV_DIR } from "../cnEnv";
import type { Draft, ReviewEvent } from "./src/draft";

const WORK_DIR = path.join(homedir(), ".local/share/claude-note-finder");
const DRAFTS_DIR = path.join(WORK_DIR, "drafts");
const POSTS_DIR = path.join(WORK_DIR, "posts");
/** A paragraph longer than this, such as a whole video transcript, is cut to a
 *  window of CONTEXT_WINDOW_CHARS around the passage. */
const MAX_PARAGRAPH_CHARS = 3_000;
const CONTEXT_WINDOW_CHARS = 1_500;
const PASSAGE_OPENING_CHARS = 40;
/** Every accept, reject, comment and revision, one JSON object per line. */
export const REVIEW_LOG_PATH = path.join(WORK_DIR, "review-log.jsonl");
const EXAMPLES_PATH = path.join(ENV_DIR, "docs/note-examples.md");

const draftPath = (file: string) => {
  if (!/^[\w.-]+\.json$/.test(file)) throw new Error(`Not a draft file name: ${file}`);
  return path.join(DRAFTS_DIR, file);
};

export function readDrafts(): Draft[] {
  if (!existsSync(DRAFTS_DIR)) return [];
  return readdirSync(DRAFTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map(readDraft);
}

export function readDraft(file: string): Draft {
  return { ...JSON.parse(readFileSync(draftPath(file), "utf8")), file };
}

export function writeDraft({ file, ...draft }: Draft) {
  writeFileSync(draftPath(file), JSON.stringify(draft, null, 2));
}

/** The paragraph of the post that contains the draft's passage, as the website
 *  shows it beside a note. An agent's passage sometimes leaves out a footnote
 *  marker inside it, so a paragraph that holds only the passage's opening words
 *  counts too. It is undefined when neither is found. */
export function contextParagraph(draft: Draft): string | undefined {
  const postText = readFileSync(path.join(POSTS_DIR, draft.postDir, "post.md"), "utf8");
  const paragraphs = postText.split(/\n\s*\n/);
  const opening = draft.passage.slice(0, PASSAGE_OPENING_CHARS);
  const paragraph = paragraphs.find((p) => p.includes(draft.passage)) ?? paragraphs.find((p) => p.includes(opening));
  if (!paragraph || paragraph.length <= MAX_PARAGRAPH_CHARS) return paragraph;
  const passageStart = Math.max(0, paragraph.indexOf(opening));
  const start = paragraph.lastIndexOf(" ", Math.max(0, passageStart - CONTEXT_WINDOW_CHARS / 2)) + 1;
  const end = paragraph.indexOf(" ", passageStart + draft.passage.length + CONTEXT_WINDOW_CHARS / 2);
  return `${start > 0 ? "… " : ""}${paragraph.slice(start, end < 0 ? undefined : end)}${end < 0 ? "" : " …"}`;
}

export function logReviewEvent(event: ReviewEvent) {
  appendFileSync(REVIEW_LOG_PATH, `${JSON.stringify(event)}\n`);
}

function quoteBlock(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** Appends one judged example to docs/note-examples.md, which the agents read
 *  before they write notes. */
export function appendExample(params: { heading: string; draft: Draft; parts: [label: string, text: string][]; why?: string }) {
  const { heading, draft, parts, why } = params;
  const body = parts.map(([label, text]) => `${label}:\n${quoteBlock(text)}\n`).join("\n");
  appendFileSync(
    EXAMPLES_PATH,
    `\n### ${heading}\nPost: [${draft.postTitle}](${draft.postUrl})\n\nPassage:\n${quoteBlock(draft.passage)}\n\n${body}${why ? `\nWhy: ${why}\n` : ""}`,
  );
}
