/**
 * Asks X's evaluate_note endpoint to score a test note on the hand-picked post.
 * It publishes nothing. If X refuses it for this post, that hints the post is
 * outside what our AI Note Writer may note.
 *
 *   bun run src/scripts_jim/2026_10_05_x_tag_bot_plan/evaluateTestNote.ts
 */

import "dotenv/config";
import { evaluateNote } from "../../pipeline/score/noteEvaluationFilter";

const POST_ID = "2107364216898490806";

try {
  console.log("answer:", JSON.stringify(await evaluateNote(POST_ID, "Test https://example.com"), null, 2));
} catch (error: any) {
  console.log("refused:", error?.response?.status, JSON.stringify(error?.response?.data ?? error?.message, null, 2));
}
