/* Lists our own notewriters and whether they are enabled, for the GOO-787 plan. */
import { getSupabaseClient } from "../../api/supabaseClient";

const { data, error } = await getSupabaseClient().from("everything_notewriters").select("*");
if (error) throw error;
for (const row of data) console.log(JSON.stringify(row));
