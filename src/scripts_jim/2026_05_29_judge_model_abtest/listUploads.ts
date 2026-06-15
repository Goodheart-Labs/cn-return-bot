/**
 * List (read-only) review_dashboard_uploads named like iter08-judge-* in prod,
 * with their item counts, so we can see which stale/broken uploads exist before
 * replacing them with clean offline re-runs.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("prod SUPABASE_URL / SUPABASE_SERVICE_KEY missing");
  const client = createClient(url, key);

  const { data, error } = await client
    .from("review_dashboard_uploads")
    .select("id, name, item_count, created_at")
    .like("name", "iter08-judge-%")
    .order("created_at", { ascending: true });
  if (error) throw error;

  console.log(`Found ${data?.length ?? 0} iter08-judge-* uploads:`);
  for (const u of data ?? []) {
    console.log(`  ${u.created_at}  ${u.id}  ${u.name}  (items=${u.item_count})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
