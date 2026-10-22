/** Counts the notes written with Claude Code: the notes Nathan and Jim posted
 *  by hand, and the notes the automatic Claude note writer posted. */
import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../everything-core/paging";

const db = getSupabaseClient();
const humanNotes = await fetchAllRows<{ id: string; author_name: string | null; created_at: string; status: string }>(
  () => db.from("everything_notes").select("id, author_name, created_at, status").not("author_id", "is", null),
  "id",
);
const byAuthorDay = new Map<string, number>();
for (const n of humanNotes) {
  const key = `${n.author_name} ${n.created_at.slice(0, 10)}`;
  byAuthorDay.set(key, (byAuthorDay.get(key) ?? 0) + 1);
}
for (const [key, count] of [...byAuthorDay].sort()) if (count >= 3) console.log(key, count);
const drafts = await fetchAllRows<{ id: string; status: string; posted_as: string | null; created_at: string; note_id: string | null }>(
  () => db.from("everything_claude_drafts").select("id, status, posted_as, created_at, note_id"),
  "id",
);
const byStatus = new Map<string, number>();
for (const d of drafts) byStatus.set(`${d.status} ${d.posted_as} live=${!!d.note_id}`, (byStatus.get(`${d.status} ${d.posted_as} live=${!!d.note_id}`) ?? 0) + 1);
console.log("claude drafts", Object.fromEntries(byStatus), "first", drafts.map((d) => d.created_at).sort()[0]);
