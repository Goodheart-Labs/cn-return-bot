import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../everything-core/paging";
const db = getSupabaseClient();
const notes = await fetchAllRows<{ id: string; author_id: string | null; author_name: string | null; created_at: string }>(
  () => db.from("everything_notes").select("id, author_id, author_name, created_at").gte("created_at", "2026-10-01"),
  "id",
);
const counts = new Map<string, number>();
for (const n of notes) {
  const key = `${n.created_at.slice(0, 10)} ${n.author_id ?? "ai"} ${n.author_name}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
for (const [k, c] of [...counts].sort()) if (!k.includes(" ai ")) console.log(k, c);
