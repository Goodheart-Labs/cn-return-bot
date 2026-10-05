// How close to X's daily writing limit are we? An approved note waits only when
// the 24-hour window is full, so this tells us how often the tag bot would queue.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DAYS_BACK = 7;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const since = new Date(Date.now() - DAYS_BACK * 24 * 3600 * 1000).toISOString();
const { data: notes, error } = await db.from("notes").select("submitted_at").gte("submitted_at", since).limit(2000);
if (error) throw error;
const perDay = new Map<string, number>();
for (const note of notes) {
  const day = note.submitted_at.slice(0, 10);
  perDay.set(day, (perDay.get(day) ?? 0) + 1);
}
console.log(`notes submitted per UTC day, last ${DAYS_BACK} days:`, Object.fromEntries([...perDay].sort()));

const { data: state } = await db.from("pipeline_state").select("*").in("key", ["writing_limit", "limit_hit_at", "limit_hit_value"]);
console.log("pipeline_state:", state);

const { data: capacity, error: capacityError } = await db.rpc("get_note_submission_capacity");
if (capacityError) throw capacityError;
console.log("capacity right now:", capacity);
