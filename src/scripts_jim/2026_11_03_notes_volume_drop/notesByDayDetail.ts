import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** For each day, splits the notes by who wrote them and by item, and lists the
 *  items with the most notes, so a single large page shows up at once. */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const SINCE = "2026-10-25";
const PAGE = 1000;
const TOP_ITEMS_PER_DAY = 5;

type NoteRow = {
  id: string; created_at: string; author_name: string | null; author_id: string | null; status: string;
  claim: { item_id: string; item: { url: string; title: string | null; project: { slug: string } | null } | null } | null;
};

const notes: NoteRow[] = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db.from("everything_notes")
    .select("id, created_at, author_name, author_id, status, claim:everything_claims(item_id, item:everything_items(url, title, project:everything_projects(slug)))")
    .gte("created_at", SINCE).order("created_at").range(from, from + PAGE - 1);
  if (error) throw error;
  notes.push(...(data as any));
  if (data.length < PAGE) break;
}

const draftNoteIds = new Set<string>();
const ids = notes.map((n) => n.id);
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await db.from("everything_claude_drafts").select("note_id").in("note_id", ids.slice(i, i + 200));
  if (error) throw error;
  for (const r of data) if (r.note_id) draftNoteIds.add(r.note_id);
}

const byDay = new Map<string, NoteRow[]>();
for (const n of notes) {
  const day = n.created_at.slice(0, 10);
  byDay.set(day, [...(byDay.get(day) ?? []), n]);
}
for (const [day, rows] of byDay) {
  const claude = rows.filter((r) => draftNoteIds.has(r.id)).length;
  const human = rows.filter((r) => r.author_id && !draftNoteIds.has(r.id)).length;
  const items = new Map<string, { n: number; label: string }>();
  for (const r of rows) {
    const key = r.claim?.item_id ?? "?";
    const label = `${r.claim?.item?.project?.slug} ${r.claim?.item?.title?.slice(0, 60) ?? r.claim?.item?.url}`;
    items.set(key, { n: (items.get(key)?.n ?? 0) + 1, label });
  }
  console.log(`\n${day}: ${rows.length} notes, ${claude} from Claude drafts, ${human} with an author id and no draft, ${items.size} items`);
  console.log("  authors:", JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(rows, (r) => r.author_name ?? "null")).map(([k, v]) => [k, v!.length]))));
  for (const it of [...items.values()].sort((a, b) => b.n - a.n).slice(0, TOP_ITEMS_PER_DAY)) console.log(`  ${String(it.n).padStart(4)}  ${it.label}`);
}
