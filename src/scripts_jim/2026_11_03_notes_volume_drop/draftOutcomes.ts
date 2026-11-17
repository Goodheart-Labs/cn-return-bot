import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** Counts Claude's drafts per day by kind, outcome and status, and the posts
 *  (items) they belong to, so we can see notes per post day by day. */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-25";
const PAGE = 1000;

const drafts: { created_at: string; kind: string; outcome: string; status: string; item_id: string; note_id: string | null }[] = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db.from("everything_claude_drafts")
    .select("created_at, kind, outcome, status, item_id, note_id")
    .gte("created_at", SINCE).order("created_at").range(from, from + PAGE - 1);
  if (error) throw error;
  drafts.push(...data);
  if (data.length < PAGE) break;
}

const byDay = Object.groupBy(drafts, (d) => d.created_at.slice(0, 10));
for (const [day, rows] of Object.entries(byDay)) {
  const tally = (key: (d: (typeof drafts)[number]) => string) =>
    JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(rows!, key)).map(([k, v]) => [k, v!.length])));
  const items = new Set(rows!.map((d) => d.item_id)).size;
  const withNote = rows!.filter((d) => d.note_id).length;
  console.log(`${day}: ${rows!.length} drafts on ${items} posts, ${withNote} with a note id (${(withNote / items).toFixed(2)} per post)`);
  console.log(`   kind/outcome ${tally((d) => `${d.kind}/${d.outcome}`)}`);
  console.log(`   status ${tally((d) => d.status)}`);
}
