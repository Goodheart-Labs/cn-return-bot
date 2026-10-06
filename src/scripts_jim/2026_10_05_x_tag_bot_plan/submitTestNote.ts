/**
 * Does X accept a note from our AI Note Writer on a post we picked by hand,
 * outside the eligibility feed? Jim asked for one real submission on 2026-10-06:
 * the note "Test" on a post by Nathan Young. This uses the production notewriter
 * keys and submits for real (test_mode false).
 *
 *   bun run src/scripts_jim/2026_10_05_x_tag_bot_plan/submitTestNote.ts
 */

import "dotenv/config";
import { submitNote } from "../../api/submitNote";

const POST_ID = "2107364216898490806";

try {
  const response = await submitNote(POST_ID, {
    classification: "misinformed_or_potentially_misleading",
    misleading_tags: ["disputed_claim_as_fact"],
    text: "Test",
    trustworthy_sources: true,
  });
  console.log("accepted:", JSON.stringify(response, null, 2));
} catch (error: any) {
  console.log("refused:", error?.response?.status, JSON.stringify(error?.response?.data ?? error?.message, null, 2));
}
