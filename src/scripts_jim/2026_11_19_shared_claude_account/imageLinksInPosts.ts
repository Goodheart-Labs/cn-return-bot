/* How many image links recent posts carry in their stored text, for the GOO-787 image screen. */
import { getSupabaseClient } from "../../api/supabaseClient";

const IMAGE_LINK = /https?:\/\/\S+?\.(?:png|jpe?g|gif|webp|avif|heic)(?:\?\S*)?|https?:\/\/substackcdn\.com\/image\/\S+/gi;
const { data, error } = await getSupabaseClient()
  .from("everything_items")
  .select("id, url, full_text")
  .not("full_text", "is", null)
  .order("created_at", { ascending: false })
  .limit(40);
if (error) throw error;
for (const item of data) console.log((item.full_text!.match(IMAGE_LINK) ?? []).length, item.url.slice(0, 80));
