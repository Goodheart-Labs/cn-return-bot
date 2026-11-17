import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-10";

const rows: { created_at: string; author_id: string | null; author_name: string | null; everything_note_sources: { quote: string | null }[] }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("everything_notes")
    .select("id, created_at, author_id, author_name, everything_note_sources(quote)")
    .gte("created_at", SINCE)
    .order("id")
    .range(from, from + 999);
  if (error) throw error;
  rows.push(...data);
  if (data.length < 1000) break;
}

const byDay = new Map<string, { total: number; withQuotes: number; noSources: number }>();
for (const r of rows) {
  if (r.author_id) continue;
  const day = `${r.created_at.slice(0, 10)} ${r.author_name ?? "pipeline"}`;
  const entry = byDay.get(day) ?? { total: 0, withQuotes: 0, noSources: 0 };
  entry.total++;
  if (r.everything_note_sources.some((s) => s.quote)) entry.withQuotes++;
  if (r.everything_note_sources.length === 0) entry.noSources++;
  byDay.set(day, entry);
}
for (const [day, e] of [...byDay].sort()) console.log(day, e);
