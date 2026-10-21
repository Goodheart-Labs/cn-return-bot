/* Prints every comment Jim writes in the review dashboard that Claude has not
 * answered yet (GOO-504), one line per comment. It first prints the comments
 * that are already waiting, then the new ones as they come in.
 *
 * With --once it exits after the first batch it prints. Claude runs it that way
 * as a background task, which wakes Claude up when the task ends. Without
 * --once it keeps running, for Claude's Monitor tool.
 *
 * Usage: bun run src/note-review/watchComments.ts [--once] */

import { existsSync, readFileSync, statSync } from "fs";
import { readDrafts, REVIEW_LOG_PATH } from "./draftStore";
import type { ReviewEvent } from "./src/draft";

const POLL_MS = 5_000;
const once = process.argv.includes("--once");

function printComment(file: string, comment: string) {
  console.log(`COMMENT ${file}: ${comment}`);
}

function printWaitingComments(): boolean {
  const waiting = readDrafts().flatMap((d) => (d.feedback ?? []).filter((f) => !f.answer).map((f) => ({ file: d.file, comment: f.comment })));
  for (const w of waiting) printComment(w.file, w.comment);
  return waiting.length > 0;
}

if (printWaitingComments() && once) process.exit(0);

let printedBytes = existsSync(REVIEW_LOG_PATH) ? statSync(REVIEW_LOG_PATH).size : 0;
setInterval(() => {
  if (!existsSync(REVIEW_LOG_PATH) || statSync(REVIEW_LOG_PATH).size <= printedBytes) return;
  const added = readFileSync(REVIEW_LOG_PATH).subarray(printedBytes).toString("utf8");
  printedBytes += Buffer.byteLength(added);
  const comments = added
    .split("\n")
    .filter(Boolean)
    .map((line): ReviewEvent => JSON.parse(line))
    .filter((event) => event.type === "feedback");
  for (const event of comments) printComment(event.file, event.comment);
  if (comments.length > 0 && once) process.exit(0);
}, POLL_MS);
