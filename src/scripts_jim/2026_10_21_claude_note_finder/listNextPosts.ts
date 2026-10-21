// Lists the posts for the next note-finding round (GOO-504): every post the prod
// pipeline fully checked after the outage posts got their attempts back, from
// every queue tier, except the posts Nathan already wrote notes on.
//
// Usage: bun run src/scripts_jim/2026_10_21_claude_note_finder/listNextPosts.ts [--json]
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** Migration 127 gave the posts that failed while the OpenRouter credits were
 *  gone (2026-10-17 to 2026-10-19) their attempts back. It shipped with PR #609,
 *  merged at 02:31 UTC on 2026-10-20. */
const RETRIES_RESET_AT = "2026-10-20T02:31:00Z";
const NATHAN_USER_ID = "963d0c31-33e5-47da-8aa1-386bc3289efb";
const MAX_ITEMS = 1000;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: items, error } = await db
  .from("everything_items")
  .select("id, url, title, processed_at, project:everything_projects(slug)")
  .eq("status", "done")
  .eq("checked_scope", "page")
  .gte("processed_at", RETRIES_RESET_AT)
  .order("processed_at")
  .limit(MAX_ITEMS);
if (error) throw error;
if (items.length === MAX_ITEMS) throw new Error(`More than ${MAX_ITEMS} posts. Page the query.`);

const { data: nathanNotes, error: notesError } = await db
  .from("everything_notes")
  .select("claim:everything_claims(item_id)")
  .eq("author_id", NATHAN_USER_ID);
if (notesError) throw notesError;
const nathanItems = new Set(nathanNotes.map((n) => (n.claim as unknown as { item_id: string }).item_id));

const posts = items.filter((item) => !nathanItems.has(item.id));
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(posts.map((p) => p.url)));
} else {
  for (const p of posts) {
    const slug = (p.project as unknown as { slug: string } | null)?.slug ?? "?";
    console.log(`${(p.processed_at as string).slice(0, 16)}  ${slug.padEnd(24)} ${p.title ?? p.url}`);
  }
  console.log(`\n${posts.length} posts since ${RETRIES_RESET_AT}, after leaving out ${items.length - posts.length} with notes by Nathan`);
}
