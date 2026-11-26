/** How many feed requests the recent walks of cn-feed-views used, and how many X said were left (GOO-880). */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db
  .from("feed_view_walks")
  .select("started_at, finished_at, complete, stop_reason, small_posts, large_posts, xl_posts, pages, rate_remaining")
  .order("started_at", { ascending: false })
  .limit(30);
if (error) throw error;
for (const w of data) console.log(w.started_at.slice(0, 16), w.complete, w.pages, "pages, left", w.rate_remaining, w.small_posts, w.large_posts, w.xl_posts, w.stop_reason ?? "");
