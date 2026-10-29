import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/** The item behind the dinosaur note, with its attempts and processing times. */
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const CLAIM_ID = "6c28f130-ef51-432c-9ddd-e256d301c936";

const { data, error } = await db
  .from("everything_claims")
  .select("item_id, everything_items(*)")
  .eq("id", CLAIM_ID)
  .single();
if (error) throw error;
const { full_text: _t, ...item } = data.everything_items as unknown as Record<string, unknown>;
console.log(JSON.stringify(item, null, 2));
