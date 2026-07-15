import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const local = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_SERVICE_KEY!);

const ITEM_ID = "71e6ebdd-93d0-4a73-a2f0-cc7644567fec";
const IMG = "https://substackcdn.com/image/fetch/$s_!23_R!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F26b0a1e2-0a1c-468f-97df-c5423ff7ada1_774x502.png";

const { data: item } = await local.from("everything_items").select("url").eq("id", ITEM_ID).single();

const { data: claim, error: ce } = await local.from("everything_claims").insert({
  item_id: ITEM_ID,
  claim: "The screenshot shows X testing a new link experience that collapses link posts to the bottom of the screen.",
  judgement: "uncertain",
  context_quote: null,          // image-only claim: no text excerpt
  context_paragraph: null,
  image_urls: [IMG],
  context_url: item?.url ?? null,
  status: "note",
}).select("id").single();
if (ce) throw new Error("claim: " + ce.message);

const { data: note, error: ne } = await local.from("everything_notes").insert({
  claim_id: claim!.id,
  note: "This screenshot is from an unverified account and the described feature was never officially announced by X. Treat it as speculation, not a confirmed product change.",
  status: "published",
}).select("id").single();
if (ne) throw new Error("note: " + ne.message);

const { error: se } = await local.from("everything_note_sources").insert({
  note_id: note!.id, url: "https://help.x.com/en/using-x", quote: "No such link-collapse feature is documented.", explanation: "X's own help center lists no such feature.", sort_order: 0,
});
if (se) throw new Error("source: " + se.message);

console.log("inserted demo image claim", claim!.id, "note", note!.id);
