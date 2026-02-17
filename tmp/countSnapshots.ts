import "dotenv/config";
import { getSupabaseClient } from "../src/api/supabaseClient";
const s = getSupabaseClient();

const { count, error } = await s.from("scraped_notewriter_snapshots").select("*", { count: "exact", head: true });
console.log("Total snapshots:", count, error?.message || "");

const { count: noteCount } = await s.from("notes").select("*", { count: "exact", head: true });
console.log("Total bot-submitted notes:", noteCount);
