import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const local = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_SERVICE_KEY!);
async function count(f: (q: any) => any) {
  const { count, error } = await f(local.from("notes").select("*", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}
console.log("our helpful / submitted, by submission day (note-maturation check):");
for (const day of ["2026-06-05", "2026-06-12", "2026-06-19", "2026-06-26", "2026-06-29", "2026-07-01", "2026-07-03"]) {
  const next = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
  const h = await count((q) =>
    q.eq("cn_status", HELPFUL).gte("submitted_at", `${day}T00:00:00Z`).lt("submitted_at", `${next}T00:00:00Z`),
  );
  const s = await count((q) => q.gte("submitted_at", `${day}T00:00:00Z`).lt("submitted_at", `${next}T00:00:00Z`));
  const pct = s ? Math.round((100 * h) / s) : 0;
  console.log(`  ${day}:  ${h} / ${s}  (${pct}% helpful)`);
}
