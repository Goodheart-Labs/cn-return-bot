/* Claude's side of the review dashboard's comments (GOO-504). It answers the
 * oldest open comment on a draft, and with a new note text it also replaces
 * the note and keeps the old version. Both go into the review log, and a
 * changed note is added to docs/note-examples.md as a before-and-after pair.
 *
 * Usage: bun run src/note-review/reviseDraft.ts <draft file name> <answer.json>
 * where answer.json is { "reply": "...", "note"?: "...", "sources"?: [...],
 * "passage"?: "..." }. A new passage moves the note to other words of the post. */

import { readFileSync } from "fs";
import { appendExample, logReviewEvent, readDraft, writeDraft } from "./draftStore";
import type { DraftSource } from "./src/draft";

const [file, answerPath] = process.argv.slice(2);
if (!file || !answerPath) throw new Error("Usage: reviseDraft.ts <draft file name> <answer.json>");
const answer: { reply: string; note?: string; sources?: DraftSource[]; passage?: string } = JSON.parse(readFileSync(answerPath, "utf8"));
if (!answer.reply) throw new Error("The answer needs a reply");

const draft = readDraft(file);
const feedback = draft.feedback ?? [];
const open = feedback.find((f) => !f.answer);
if (!open) throw new Error(`Draft ${file} has no open comment`);

const at = new Date().toISOString();
open.answer = { at, reply: answer.reply };
const changed = answer.note !== undefined && answer.note !== draft.note;
if (changed && draft.review) throw new Error(`Draft ${file} was already ${draft.review.decision}, so its note cannot change here`);
writeDraft({
  ...draft,
  feedback,
  ...(changed && {
    note: answer.note,
    sources: answer.sources ?? draft.sources,
    passage: answer.passage ?? draft.passage,
    revisions: [...(draft.revisions ?? []), { at, previousNote: draft.note, previousSources: draft.sources, reason: open.comment }],
  }),
});

if (changed) {
  logReviewEvent({ type: "revised", at, file, note: answer.note!, previousNote: draft.note, reply: answer.reply });
  appendExample({
    heading: `Rewritten after Jim's comment (${at.slice(0, 10)})`,
    draft,
    parts: [
      ["Earlier version", draft.note],
      ["Jim's comment", open.comment],
      ["New version", answer.note!],
    ],
  });
}
console.log(changed ? `Answered and revised ${file}` : `Answered ${file} without changing the note`);
