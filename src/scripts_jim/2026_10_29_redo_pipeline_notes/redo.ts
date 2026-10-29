import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { deletePipelineNote } from "../../claude-notes/store";

/** Removes the notes the pipeline wrote after Claude became the note writer, and makes their posts look
 *  unprocessed, so the walk picks them again and Claude checks them (GOO-652).
 *
 *  A post the pipeline checked is one with an extraction, rating or check run since the switch and no
 *  Claude draft. Each of its pipeline notes goes through deletePipelineNote, the path Claude uses for a
 *  pipeline note it judges bad: the note and its votes are deleted, the claim stays with status no_note,
 *  and an event keeps the note's text. A note with votes is left alone, because deleting it also deletes
 *  the voter's donation pledge.
 *
 *  The post then gets checked_scope null, which is what the walk reads as "not checked as a whole page"
 *  (unprocessedEntries in autoEnqueue.ts). first_checked_at is cleared, so the trigger of migration 133
 *  sets it again when Claude finishes the post.
 *
 *    bun run src/scripts_jim/2026_10_29_redo_pipeline_notes/redo.ts          # shows what it would do
 *    bun run src/scripts_jim/2026_10_29_redo_pipeline_notes/redo.ts --write  # does it */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const CLAUDE_BECAME_THE_WRITER = "2026-10-21T15:13:04Z";
const PIPELINE_RUN_KINDS = ["extraction", "rating", "check"];
const CLAUDE_JUDGEMENT = "claude_code";
const REASON = "Written by the pipeline after a hand-back. Claude checks the post again (GOO-652).";
const MAX_ROWS = 1000;
const write = process.argv.includes("--write");

const unwrap = <T>(result: { data: T | null; error: unknown }): T => {
  if (result.error) throw result.error;
  return result.data!;
};

const runs = unwrap(
  await db
    .from("everything_pipeline_runs")
    .select("item_id, everything_claims(item_id)")
    .in("kind", PIPELINE_RUN_KINDS)
    .gte("created_at", CLAUDE_BECAME_THE_WRITER)
    .limit(MAX_ROWS),
);
if (runs.length === MAX_ROWS) throw new Error("Supabase cut the runs off at 1000 rows. Page through them.");
const runItemIds = new Set(runs.map((r) => r.item_id ?? (r.everything_claims as unknown as { item_id: string } | null)?.item_id).filter(Boolean) as string[]);
const drafted = new Set(unwrap(await db.from("everything_claude_drafts").select("item_id").in("item_id", [...runItemIds])).map((d) => d.item_id));
const itemIds = [...runItemIds].filter((id) => !drafted.has(id));

const items = unwrap(await db.from("everything_items").select("id, url, checked_scope").in("id", itemIds));
for (const item of items) {
  const claims = unwrap(
    await db.from("everything_claims").select("judgement, everything_notes(id, author_id, helpful_count, somewhat_helpful_count, not_helpful_count)").eq("item_id", item.id),
  );
  const notes = claims.filter((c) => c.judgement !== CLAUDE_JUDGEMENT).flatMap((c) => c.everything_notes.filter((n) => n.author_id === null));
  const voted = notes.filter((n) => n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count > 0);
  const toDelete = notes.filter((n) => !voted.includes(n));
  console.log(`${item.url}: delete ${toDelete.length} notes, keep ${voted.length} with votes${voted.length ? ` (${voted.map((n) => n.id).join(", ")})` : ""}`);
  if (!write) continue;
  for (const note of toDelete) await deletePipelineNote(item.id, note.id, REASON);
  unwrap(await db.from("everything_items").update({ checked_scope: null, first_checked_at: null, skip_reason: null, error: null }).eq("id", item.id).select("id"));
}
console.log(write ? `Done: ${items.length} posts reset.` : `Dry run over ${items.length} posts. Pass --write to apply.`);
