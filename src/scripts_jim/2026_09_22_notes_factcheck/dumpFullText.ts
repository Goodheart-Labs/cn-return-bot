// Fetch the body text of every item that carries at least one AI note, so the
// reviewers can read the original source without refetching it.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const dump = JSON.parse(await Bun.file("src/scripts_jim/2026_09_22_notes_factcheck/dump.json").text());
const itemIds = [...new Set(dump.claims.map((c: any) => c.item_id))] as string[];
const texts: Record<string, string | null> = {};
for (let i = 0; i < itemIds.length; i += 50) {
  const { data, error } = await db.from("everything_items").select("id, full_text").in("id", itemIds.slice(i, i + 50));
  if (error) throw error;
  for (const row of data!) texts[row.id] = row.full_text;
}
writeFileSync("src/scripts_jim/2026_09_22_notes_factcheck/fullText.json", JSON.stringify(texts));
const missing = Object.values(texts).filter((t) => !t).length;
console.log({ items: itemIds.length, missing });
