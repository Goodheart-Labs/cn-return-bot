/* Every item of one creator with its tier, publication day, enqueue and finish
 * time, to see when the walk reached them (GOO-549).
 *   bun run src/scripts_jim/2026_10_23_post_processing_delay/creatorHistory.ts <slug> */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const slug = process.argv[2]!;
const { data: project } = await db.from("everything_projects").select("id, priority_until, feed_url").eq("slug", slug).single();
console.log(slug, "priority until", project!.priority_until);
const { data: items } = await db.from("everything_items").select("created_at, processed_at, priority, published_at, status, retries, checked_scope, skip_reason, title").eq("project_id", project!.id).order("published_at", { ascending: false });
for (const i of items!) console.log([i.published_at, i.created_at.slice(0, 16), i.processed_at?.slice(0, 16) ?? "-", `tier ${i.priority}`, i.status, i.retries, i.checked_scope, (i.skip_reason ?? "").slice(0, 20), (i.title ?? "").slice(0, 40)].join("  "));
