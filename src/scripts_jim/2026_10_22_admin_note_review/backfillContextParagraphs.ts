// Gives every Claude draft saved before migration 130 its context paragraph
// (GOO-518). The review page on commonnotes.net shows the post's paragraph
// around the passage, and since migration 130 the draft stores it, so the page
// never downloads a whole post. Drafts saved earlier have none yet. The script
// works the paragraph out the same way saving a draft does now.
// Run once, after migration 130: bun run src/scripts_jim/2026_10_22_admin_note_review/backfillContextParagraphs.ts
import { createClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import { ENV_DIR } from "../../cnEnv";
import { contextParagraph } from "../../claude-notes/store";
import type { Database } from "../../everything-core/database.types";
import { fetchAllRows, fetchInBatches } from "../../everything-core/paging";

loadDotenv({ path: `${ENV_DIR}/.env`, quiet: true });
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const drafts = await fetchAllRows<{ id: string; item_id: string; passage: string }>(
  () => db.from("everything_claude_drafts").select("id, item_id, passage").is("context_paragraph", null),
  "id",
  { label: "drafts without a paragraph" },
);
const items = await fetchInBatches<{ id: string; full_text: string | null }>(
  (chunk) => db.from("everything_items").select("id, full_text").in("id", chunk),
  [...new Set(drafts.map((d) => d.item_id))],
  "id",
  { label: "draft items" },
);
const textOf = new Map(items.map((i) => [i.id, i.full_text]));

let filled = 0;
for (const draft of drafts) {
  const paragraph = contextParagraph(textOf.get(draft.item_id) ?? null, draft.passage);
  if (!paragraph) continue;
  const { error } = await db.from("everything_claude_drafts").update({ context_paragraph: paragraph }).eq("id", draft.id);
  if (error) throw new Error(JSON.stringify(error));
  filled++;
}
console.log(`${filled} of ${drafts.length} drafts without a paragraph got one. The others have no matching paragraph in their post.`);
