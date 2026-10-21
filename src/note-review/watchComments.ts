/* Prints each new comment Jim writes in the review dashboard (GOO-504), one
 * line per comment, and keeps running. Claude runs it under its Monitor tool,
 * so every line wakes Claude up to work on the comment.
 *
 * Usage: bun run src/note-review/watchComments.ts */

import { existsSync, readFileSync, statSync } from "fs";
import { REVIEW_LOG_PATH } from "./draftStore";
import type { ReviewEvent } from "./src/draft";

const POLL_MS = 5_000;

let printedBytes = existsSync(REVIEW_LOG_PATH) ? statSync(REVIEW_LOG_PATH).size : 0;
console.log(`Watching ${REVIEW_LOG_PATH} for new comments`);

setInterval(() => {
  if (!existsSync(REVIEW_LOG_PATH) || statSync(REVIEW_LOG_PATH).size <= printedBytes) return;
  const added = readFileSync(REVIEW_LOG_PATH).subarray(printedBytes).toString("utf8");
  printedBytes += Buffer.byteLength(added);
  for (const line of added.split("\n").filter(Boolean)) {
    const event: ReviewEvent = JSON.parse(line);
    if (event.type === "feedback") console.log(`COMMENT ${event.file}: ${event.comment}`);
  }
}, POLL_MS);
