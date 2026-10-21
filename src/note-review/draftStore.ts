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
