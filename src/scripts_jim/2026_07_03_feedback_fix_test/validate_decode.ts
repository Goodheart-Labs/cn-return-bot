import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
const local = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_SERVICE_KEY!);
const sfDate = (id: string) => new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toISOString();
const { data } = await local
  .from("notes")
  .select("note_id, submitted_at")
  .not("submitted_at", "is", null)
  .order("submitted_at", { ascending: false })
  .limit(5);
console.log("note_id snowflake-decode vs stored submitted_at (our notes):");
for (const n of data!) console.log(`  decoded ${sfDate(n.note_id)}  |  submitted_at ${n.submitted_at}`);
