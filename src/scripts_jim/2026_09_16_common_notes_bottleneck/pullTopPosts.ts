/** Dumps everything_top_posts so failing items can be told apart: an all-time
 *  top pick or a fresh upload. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db.from("everything_top_posts").select("*").range(0, 4999);
if (error) throw error;
await Bun.write(process.argv[2]!, JSON.stringify(data));
console.log(data!.length, "rows; columns:", Object.keys(data![0] ?? {}).join(", "));
