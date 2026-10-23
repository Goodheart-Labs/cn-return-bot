/* When we first had any item of each catch-up creator, and of what tier, to
 * see whether the ranking's "followed since" rule excludes their catch-up. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
for (const slug of ["visualpolitik", "wired", "moneymacro", "eightythousandhours", "aiexplained-official", "dwarkeshpatel", "kurzgesagt"]) {
  const { data } = await db.from("everything_items").select("created_at, priority, published_at, checked_scope, title, project:everything_projects!inner(slug)").eq("project.slug", slug).order("created_at").limit(4);
  console.log(slug, JSON.stringify(data!.map((d: any) => [d.created_at.slice(0, 16), d.priority, d.published_at, d.checked_scope, d.title?.slice(0, 25)])));
}
