import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const prod = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const local = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_SERVICE_KEY!);

async function fetchAll(sb: any, table: string, order: string): Promise<any[]> {
  const rows: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("*").order(order).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function insertAll(table: string, rows: any[]) {
  if (!rows.length) { console.log(`  ${table}: 0`); return; }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await local.from(table).insert(chunk);
    if (error) throw new Error(`insert ${table}: ${error.message}`);
  }
  console.log(`  ${table}: ${rows.length}`);
}

// Wipe local everything_* (children first) so re-runs are clean.
console.log("clearing local…");
for (const t of ["everything_note_sources","everything_votes","everything_notes","everything_claims","everything_items","everything_projects"]) {
  const { error } = await local.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error && !/does not exist/.test(error.message)) {
    // votes has no id column — delete by note_id
    if (t === "everything_votes") await local.from(t).delete().neq("note_id", "00000000-0000-0000-0000-000000000000");
    else throw new Error(`clear ${t}: ${error.message}`);
  }
}

console.log("copying…");
await insertAll("everything_projects", await fetchAll(prod, "everything_projects", "created_at"));
await insertAll("everything_items", await fetchAll(prod, "everything_items", "created_at"));
await insertAll("everything_claims", await fetchAll(prod, "everything_claims", "created_at"));

// Notes: prod still carries the `sources` jsonb; local dropped it for a table.
const notes = await fetchAll(prod, "everything_notes", "created_at");
const noteSources: any[] = [];
for (const n of notes) {
  const srcs: string[] = Array.isArray(n.sources) ? n.sources : [];
  srcs.forEach((url, i) => noteSources.push({ note_id: n.id, url, quote: null, explanation: null, sort_order: i }));
  delete n.sources;
}
await insertAll("everything_notes", notes);
await insertAll("everything_note_sources", noteSources);
await insertAll("everything_votes", await fetchAll(prod, "everything_votes", "created_at"));

console.log("done");
