/**
 * Prints the Safari waitlist (migration 162, GOO-677): every address that
 * asked for one email when the Safari extension is out, one per line, oldest
 * first. Paste them into the BCC field of one email, or import them into an
 * email service.
 *
 * It reads with the service key from the root .env, because the public key
 * cannot read the list.
 *
 * Usage:
 *   bun run safari-waitlist
 */

import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";
import { fetchAllRows } from "../everything-core/paging";

const db = getSupabaseClient();
const rows = await fetchAllRows<{ id: number; email: string }>(
  () => db.from("everything_safari_waitlist").select("id, email"),
  "id",
);
for (const row of rows) console.log(row.email);
console.error(`${rows.length} addresses on the Safari waitlist`);
