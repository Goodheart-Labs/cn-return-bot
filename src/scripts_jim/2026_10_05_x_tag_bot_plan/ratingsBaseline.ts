// The one Signal note had 0 ratings two weeks after submission. Is that unusual
// for notes our automatic pipeline submitted in the same days?
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const { data: notes, error } = await db
  .from("notes")
  .select("note_id, cn_status, rating_count, last_reconciled_at")
  .gte("submitted_at", "2026-09-19T00:00:00Z")
  .lt("submitted_at", "2026-09-23T00:00:00Z")
  .limit(1000);
if (error) throw error;

const withZeroRatings = notes.filter((note) => !note.rating_count).length;
const statusCounts = new Map<string, number>();
for (const note of notes) statusCounts.set(note.cn_status, (statusCounts.get(note.cn_status) ?? 0) + 1);
console.log(`notes submitted 2026-09-19 to 2026-09-22: ${notes.length}`);
console.log(`with rating_count 0 or null: ${withZeroRatings}`);
console.log("by status:", Object.fromEntries(statusCounts));
