/**
 * Verify the updateNoteFeedback fix on LOCAL supabase.
 * Counts our helpful notes overall and by submission day, so we can compare
 * before/after running `bun run update-feedback --local`.
 *
 * Usage: bun run src/scripts_jim/2026_07_03_feedback_fix_test/verify.ts
 */
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const HELPFUL = "CURRENTLY_RATED_HELPFUL";
const local = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_SERVICE_KEY!);

async function count(filter: (q: any) => any): Promise<number> {
  const { count, error } = await filter(local.from("notes").select("*", { count: "exact", head: true }));
  if (error) throw new Error(error.message || JSON.stringify(error));
  return count ?? 0;
}

const totalNotes = await count((q) => q);
const totalHelpful = await count((q) => q.eq("cn_status", HELPFUL));
console.log(`total notes:          ${totalNotes}`);
console.log(`total helpful notes:  ${totalHelpful}`);

console.log(`\nhelpful notes by submitted_at day:`);
for (const day of ["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03"]) {
  const next = new Date(Date.parse(day) + 86400_000).toISOString().slice(0, 10);
  const helpful = await count((q) =>
    q.eq("cn_status", HELPFUL).gte("submitted_at", `${day}T00:00:00Z`).lt("submitted_at", `${next}T00:00:00Z`),
  );
  const submitted = await count((q) =>
    q.gte("submitted_at", `${day}T00:00:00Z`).lt("submitted_at", `${next}T00:00:00Z`),
  );
  console.log(`  ${day}:  ${helpful} helpful / ${submitted} submitted`);
}
