/** When each YouTube creator's all-time-top list was last refreshed, and what
 *  joerogan's cached list holds. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: p } = await db.from("everything_projects").select("slug, feed_url, top_posts_refreshed_at").ilike("feed_url", "%youtube.com%").order("top_posts_refreshed_at", { ascending: true, nullsFirst: true });
for (const r of p!) console.log(`${(r.top_posts_refreshed_at ?? "never").slice(0, 16).padEnd(17)} ${r.slug}`);
const { data: t } = await db.from("everything_top_posts").select("rank, popularity, title").eq("feed_url", "https://www.youtube.com/@joerogan").order("rank");
console.log("joerogan cached top list:", t?.map((r) => `#${r.rank} ${r.popularity} ${r.title}`).join(" | ") ?? "none");
