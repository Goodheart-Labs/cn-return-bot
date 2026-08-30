/**
 * Confirm LOCAL_X_* is the prod notewriter: paginate all its notes_written,
 * report total + newest note, and check overlap with our local `notes` table.
 */
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const c = {
  key: process.env.LOCAL_X_API_KEY!,
  secret: process.env.LOCAL_X_API_KEY_SECRET!,
  token: process.env.LOCAL_X_ACCESS_TOKEN!,
  tokenSecret: process.env.LOCAL_X_ACCESS_TOKEN_SECRET!,
};
function headers(url: string) {
  const oauth = new OAuth({
    consumer: { key: c.key, secret: c.secret },
    signature_method: "HMAC-SHA1",
    hash_function: (b, k) => crypto.createHmac("sha1", k).update(b).digest("base64"),
  });
  return oauth.toHeader(oauth.authorize({ url, method: "GET" }, { key: c.token, secret: c.tokenSecret }));
}
function sfDate(id: string): number {
  return Number((BigInt(id) >> 22n) + 1288834974657n);
}

const ids: string[] = [];
let statusHelpful = 0;
let token: string | undefined;
let pages = 0;
while (true) {
  let url = "https://api.x.com/2/notes/search/notes_written?test_mode=false&max_results=100&note.fields=id,status";
  if (token) url += `&pagination_token=${token}`;
  const res = await fetch(url, { headers: { ...headers(url), "Content-Type": "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  for (const n of body.data ?? []) {
    ids.push(n.id);
    if (n.status === "currently_rated_helpful") statusHelpful++;
  }
  pages++;
  token = body.meta?.next_token;
  if (!token) break;
}

const dates = ids.map(sfDate).sort((a, b) => a - b);
console.log(`LOCAL_X_* notewriter: ${ids.length} notes across ${pages} pages`);
console.log(`  oldest note (by id):  ${new Date(dates[0]).toISOString()}`);
console.log(`  newest note (by id):  ${new Date(dates[dates.length - 1]).toISOString()}`);
console.log(`  helpful (API status): ${statusHelpful}/${ids.length}`);

const local = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_SERVICE_KEY!);
const sample = ids.slice(0, 200);
const { data, error } = await local.from("notes").select("note_id").in("note_id", sample);
if (error) throw error;
console.log(`  overlap with local notes table: ${data.length}/${sample.length} of a 200-id sample are in our notes table`);
