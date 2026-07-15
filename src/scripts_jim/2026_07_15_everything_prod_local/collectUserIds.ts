import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const prod = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const ids = new Set<string>();
for (const [t, col] of [["everything_claims","created_by"],["everything_notes","author_id"],["everything_votes","voter_id"]] as const) {
  const { data } = await prod.from(t).select(col).not(col, "is", null).limit(5000);
  for (const r of data ?? []) if ((r as any)[col]) ids.add((r as any)[col]);
}
console.log([...ids].join("\n"));
