import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const local = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_SERVICE_KEY!);
const NOTE_SELECT = "*, claim:everything_claims(id, item_id, claim, context_quote, context_paragraph, image_urls, updated_quote, context_url, start_seconds, end_seconds), sources:everything_note_sources(url, quote, explanation, sort_order)";
const { data, error } = await local.from("everything_notes").select(NOTE_SELECT).limit(2);
if (error) throw new Error(error.message);
console.log(`notes: ${data?.length}`);
const n = data?.[0];
console.log("sample note keys:", Object.keys(n));
console.log("claim.image_urls:", n.claim?.image_urls, "| sources:", n.sources?.length);
// anon read check (the SPA uses the anon key)
const anon = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);
const { data: a, error: ae } = await anon.from("everything_notes").select(NOTE_SELECT).limit(1);
console.log("anon read:", ae ? `ERROR ${ae.message}` : `ok (${a?.length})`);
