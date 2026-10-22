import "dotenv/config";
import { getSupabaseClient } from "../../api/supabaseClient";
const db = getSupabaseClient();
console.log(await db.from("everything_notes").select("id, author_id, author_name, created_at").eq("id", "81627bac-1e81-44c9-9a06-172f4bb06d09"));
const { count } = await db.from("everything_notes").select("id", { count: "exact", head: true }).eq("author_name", "NathanpmYoung");
console.log("nathan notes", count);
