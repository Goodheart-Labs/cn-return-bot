/**
 * Picks the posts for the GOO-433 gate check and saves them to items.json.
 * The memoir set is every item of the two creators named in the ticket from
 * 7 to 12 October. The control set is recent feed posts that produced at least
 * one note, so the new gate must keep letting them through.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const MEMOIR_CREATORS = ["jamesguilty", "aella"];
const MEMOIR_WINDOW = { from: "2026-10-07", to: "2026-10-13" };
const CONTROL_WINDOW_START = "2026-10-05";
const CONTROL_SAMPLE_SIZE = Number(process.argv[2] ?? 20);

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

interface ItemRow {
  id: string;
  url: string;
  title: string | null;
  full_text: string | null;
  processed_at: string | null;
  project_id: string | null;
}

async function claimStats(itemId: string) {
  const { data, error } = await db.from("everything_claims").select("id, status").eq("item_id", itemId);
  if (error) throw error;
  const claimIds = data.map((c) => c.id);
  const checked = data.filter((c) => c.status !== "skipped").length;
  let notes = 0;
  for (let i = 0; i < claimIds.length; i += 150) {
    const { count, error: noteError } = await db
      .from("everything_notes")
      .select("id", { count: "exact", head: true })
      .in("claim_id", claimIds.slice(i, i + 150));
    if (noteError) throw noteError;
    notes += count ?? 0;
  }
  return { claims: data.length, checked, notes };
}

async function memoirItems() {
  const { data: projects, error } = await db.from("everything_projects").select("id, feed_url");
  if (error) throw error;
  const ids = projects.filter((p) => MEMOIR_CREATORS.some((c) => p.feed_url?.includes(`${c}.substack.com`))).map((p) => p.id);
  const { data: items, error: itemError } = await db
    .from("everything_items")
    .select("id, url, title, full_text, processed_at, project_id")
    .in("project_id", ids)
    .eq("status", "done")
    .gte("processed_at", MEMOIR_WINDOW.from)
    .lt("processed_at", MEMOIR_WINDOW.to);
  if (itemError) throw itemError;
  return items as ItemRow[];
}

async function controlItems(excludeProjects: Set<string>) {
  const { data, error } = await db
    .from("everything_items")
    .select("id, url, title, processed_at, project_id")
    .eq("status", "done")
    .eq("checked_scope", "page")
    .lt("priority", 2)
    .not("full_text", "is", null)
    .gte("processed_at", CONTROL_WINDOW_START)
    .order("processed_at", { ascending: false })
    .limit(CONTROL_SAMPLE_SIZE * 10);
  if (error) throw error;
  const picked: (ItemRow & Awaited<ReturnType<typeof claimStats>>)[] = [];
  for (const item of data as Omit<ItemRow, "full_text">[]) {
    if (picked.length >= CONTROL_SAMPLE_SIZE) break;
    if (item.project_id && excludeProjects.has(item.project_id)) continue;
    const stats = await claimStats(item.id);
    if (stats.notes === 0) continue;
    const { data: body, error: bodyError } = await db.from("everything_items").select("full_text").eq("id", item.id).single();
    if (bodyError) throw bodyError;
    picked.push({ ...item, full_text: body.full_text, ...stats });
  }
  return picked;
}

const memoirs = await memoirItems();
const memoirsWithStats = [];
for (const item of memoirs) memoirsWithStats.push({ ...item, ...(await claimStats(item.id)) });
const controls = await controlItems(new Set(memoirs.map((m) => m.project_id!)));
writeFileSync(
  new URL("./items.json", import.meta.url),
  JSON.stringify({ memoirs: memoirsWithStats, controls }, null, 2),
);
for (const set of [memoirsWithStats, controls]) {
  for (const i of set) console.log(`${i.claims}\t${i.checked}\t${i.notes}\t${i.full_text?.length ?? 0}\t${i.title}`);
  console.log("---");
}
