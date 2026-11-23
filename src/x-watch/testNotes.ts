/**
 * Lists the most recent test notes of an X account with the scores X's
 * evaluator gave them, and whether they meet X's admission criteria
 * (admission.ts, GOO-851). It reads only X's API and changes nothing.
 *
 *   bun run x-watch-test-notes [--max-notes N]
 */

import "dotenv/config";
import { fetchNotesWritten } from "../api/fetchNotesWritten";
import { describeSummary, summariseTestNotes } from "./admission";
import { TEST_NOTES_FOR_ADMISSION } from "./room";

const maxNotesFlag = process.argv.indexOf("--max-notes");
const maxNotes = maxNotesFlag === -1 ? TEST_NOTES_FOR_ADMISSION : Number(process.argv[maxNotesFlag + 1]);
const notes = await fetchNotesWritten({ testMode: true, maxNotes });

for (const note of notes) {
  const scores = note.test_result?.evaluation_outcome?.map((o) => `${o.evaluator_type} ${o.evaluator_score_bucket}`).join(", ") || "not scored yet";
  console.log(`https://x.com/i/status/${note.post_id}\n  ${note.info?.text ?? "(no text)"}\n  ${scores}\n`);
}
console.log(describeSummary(summariseTestNotes(notes)));
