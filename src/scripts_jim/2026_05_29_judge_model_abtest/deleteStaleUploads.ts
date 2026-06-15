/**
 * Delete the stale iter08-judge-* review_dashboard_uploads (and their items)
 * from prod. These are the X-402-broken 100-item runs + the 2-row smoke tests,
 * all superseded by the clean offline re-run. Scoped to an explicit id list so
 * nothing else is touched. Deletes items first, then the upload row.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const STALE_UPLOAD_IDS = [
  "f3ab6431-b161-49a0-b54f-29496b653dcd", // iter08-judge-sonnet46 (X-402, 66 errors)
  "6be88c25-d1f7-4e9e-80fe-90d9395df6e2", // iter08-judge-deepseek-v4flash (X-402)
  "1a956516-3d75-4ad1-969a-0b80496084f7", // iter08-judge-deepseek-v4pro (X-402)
  "8e9e48d1-600e-4dbf-94ff-72dac26620c8", // iter08-judge-gemini3flash (X-402)
  "a6def330-2a41-49de-9435-2c1f0e555cd0", // iter08-judge-sonnet46 (2-row smoke)
  "0d446798-a292-420f-af16-ded2bbe462d9", // iter08-judge-deepseek-v4flash (2-row smoke)
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("prod SUPABASE_URL / SUPABASE_SERVICE_KEY missing");
  const client = createClient(url, key);

  for (const id of STALE_UPLOAD_IDS) {
    const { error: itemsErr, count } = await client
      .from("review_dashboard_items")
      .delete({ count: "exact" })
      .eq("upload_id", id);
    if (itemsErr) throw itemsErr;

    const { error: upErr } = await client
      .from("review_dashboard_uploads")
      .delete()
      .eq("id", id);
    if (upErr) throw upErr;

    console.log(`deleted upload ${id} (+${count ?? "?"} items)`);
  }
  console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
