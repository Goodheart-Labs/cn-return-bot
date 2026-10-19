/** Reads the text of the items of the datapoints, read-only. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { fetchPostBodyText } from "../../../everything/sources/substack";
import type { Datapoint } from "./datapoints";

/** The stored text of each item. An item without stored text is read from the
 *  Substack post its datapoint names, and if it names none this throws. */
export async function loadItemTexts(datapoints: Datapoint[]): Promise<Map<string, string>> {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data, error } = await db.from("everything_items").select("id, full_text").in("id", [...new Set(datapoints.filter((d) => !("checkerOnly" in d)).map((d) => d.itemId))]);
  if (error) throw error;
  const texts = new Map<string, string>();
  for (const item of data) {
    if (item.full_text) {
      texts.set(item.id, item.full_text);
      continue;
    }
    const source = datapoints.find((d) => d.itemId === item.id && d.textFromSubstackPost)?.textFromSubstackPost;
    if (!source) throw new Error(`Item ${item.id} has no stored text and its datapoint names no Substack post`);
    texts.set(item.id, await fetchPostBodyText(source.publicationUrl, source.postUrl));
  }
  return texts;
}
