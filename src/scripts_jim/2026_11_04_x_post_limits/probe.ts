import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const one = await db.from("pipeline_runs").select("*").order("created_at", { ascending: false }).limit(1);
if (one.error) throw one.error;
console.log(Object.keys(one.data[0]).join(", "));
const st = await db.from("pipeline_state").select("*");
console.log(st.data);
