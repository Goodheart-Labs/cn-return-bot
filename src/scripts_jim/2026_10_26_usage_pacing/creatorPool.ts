/* Counts how many creators the walk would see at different score thresholds,
 * to judge how far removing the walk's threshold widens the pool. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db.from("everything_creator_visits").select("*").limit(5000);
if (error) throw error;
console.log("columns", Object.keys(data[0] ?? {}));
console.log("rows", data.length);
const { count } = await db.from("everything_projects").select("*", { count: "exact", head: true }).not("feed_url", "is", null);
console.log("projects with a feed", count);
