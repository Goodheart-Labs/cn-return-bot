/** Re-reads the current status of every YouTube item that failed with
 *  "No transcript available" since 2026-09-15, so a later retry that
 *  succeeded is visible. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db
  .from("everything_items")
  .select("url, title, status, retries, error, published_at, processed_at, project_id, everything_projects(slug)")
  .eq("source", "youtube")
  .gte("started_at", "2026-09-15")
  .or("error.ilike.%No transcript%,status.eq.error")
  .order("processed_at");
if (error) throw error;
for (const i of data!) console.log(`${i.status.padEnd(6)} tries=${i.retries + 1} last=${(i.processed_at ?? "").slice(5, 16)} ${(i as any).everything_projects?.slug?.padEnd(26)} ${i.url}  ${(i.error ?? "").slice(0, 40)}`);
