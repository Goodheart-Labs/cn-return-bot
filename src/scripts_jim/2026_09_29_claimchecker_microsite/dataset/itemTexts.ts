/** Reads the stored text of production items, read-only. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

export async function loadItemTexts(itemIds: string[]): Promise<Map<string, string>> {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data, error } = await db.from("everything_items").select("id, full_text").in("id", [...new Set(itemIds)]);
  if (error) throw error;
  return new Map(data.map((item) => [item.id, item.full_text as string]));
}
