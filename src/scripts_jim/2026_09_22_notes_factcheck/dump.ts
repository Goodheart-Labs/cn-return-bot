// Dump every published AI note with its claim, item and project into one JSON file,
// so the review can run offline and the fan-out subagents read local files only.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const PAGE = 1000;

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(select).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data as T[]));
    if (data!.length < PAGE) break;
  }
  return rows;
}

const projects = await fetchAll<any>("everything_projects", "id, slug, name, feed_url");
const items = await fetchAll<any>("everything_items", "id, project_id, source, url, title, published_at, status, checked_scope");
const notes = await fetchAll<any>("everything_notes", "id, claim_id, note, status, author_id, helpful_count, not_helpful_count, created_at, improved_from_note_id");
const sources = await fetchAll<any>("everything_note_sources", "note_id, url, quote, explanation");
const claimIds = [...new Set(notes.map((n) => n.claim_id))];
const claims: any[] = [];
for (let i = 0; i < claimIds.length; i += 200) {
  const { data, error } = await db
    .from("everything_claims")
    .select("id, item_id, claim, judgement, context_quote, context_paragraph, context_url, start_seconds, end_seconds, image_urls, updated_quote, status")
    .in("id", claimIds.slice(i, i + 200));
  if (error) throw error;
  claims.push(...data!);
}
const out = { projects, items, notes, sources, claims };
writeFileSync("src/scripts_jim/2026_09_22_notes_factcheck/dump.json", JSON.stringify(out));
console.log({ projects: projects.length, items: items.length, notes: notes.length, claims: claims.length, sources: sources.length });
