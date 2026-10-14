/**
 * Lists, read-only, the notes on the Dwarkesh podcast's YouTube episodes that
 * the community rated helpful, so that one of them can become a datapoint with
 * a transcript. Run from the repository root.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/findYoutubeNotes.ts [project-slug-part]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { noteStatus } from "../../../everything-core/noteScore";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const slugPart = process.argv[2] ?? "dwarkesh";

const { data: projects, error: projectError } = await db.from("everything_projects").select("id, slug, name, feed_url").ilike("slug", `%${slugPart}%`);
if (projectError) throw projectError;
console.log("Projects:", projects);

for (const project of projects!) {
  const { data: items, error: itemError } = await db.from("everything_items").select("id, title, url, source, status, checked_scope, published_at").eq("project_id", project.id).limit(1000);
  if (itemError) throw itemError;
  console.log(`\n${project.slug}: ${items!.length} items`);
  for (const item of items!) {
    const { data: claims, error: claimError } = await db.from("everything_claims").select("id, claim, context_quote, status, judgement").eq("item_id", item.id).limit(1000);
    if (claimError) throw claimError;
    const claimIds = claims!.map((c) => c.id);
    if (claimIds.length === 0) continue;
    const { data: notes, error: noteError } = await db.from("everything_notes").select("id, claim_id, note, status, helpful_count, somewhat_helpful_count, not_helpful_count, author_name, improved_from_note_id").in("claim_id", claimIds.slice(0, 200));
    if (noteError) throw noteError;
    const helpful = notes!.filter((n) => noteStatus(n as any) === "helpful");
    if (helpful.length === 0) continue;
    console.log(`\n== ${item.title} (${item.source}, ${item.url}) ${item.id}: ${claims!.length} claims, ${notes!.length} notes, ${helpful.length} rated helpful`);
    for (const n of helpful) {
      const claim = claims!.find((c) => c.id === n.claim_id)!;
      console.log(`  note ${n.id} votes ${n.helpful_count}/${n.somewhat_helpful_count}/${n.not_helpful_count} by ${n.author_name ?? "AI"} status=${n.status}`);
      console.log(`    claim ${claim.id}: ${claim.claim.slice(0, 200)}`);
      console.log(`    quote: ${(claim.context_quote ?? "").slice(0, 200)}`);
      console.log(`    note: ${n.note.slice(0, 300)}`);
    }
  }
}
