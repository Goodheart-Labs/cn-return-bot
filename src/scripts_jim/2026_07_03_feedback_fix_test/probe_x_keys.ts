/**
 * Identify which X credential set belongs to the prod notewriter.
 * For each OAuth1 cred set in .env: call users/me (who am I) and
 * notes/search/notes_written (how many notes, how recent).
 * The notewriter returns thousands of notes; personal accounts ~0.
 *
 * Read-only. Usage: bun run src/scripts_jim/2026_07_03_feedback_fix_test/probe_x_keys.ts
 */
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import "dotenv/config";

const CRED_SETS = ["X", "LOCAL_X", "X_JIMMAAR1", "X_NATHANPMYOUNG"] as const;

type Creds = { key: string; secret: string; token: string; tokenSecret: string };

function loadCreds(prefix: string): Creds | null {
  const key = process.env[`${prefix}_API_KEY`];
  const secret = process.env[`${prefix}_API_KEY_SECRET`];
  const token = process.env[`${prefix}_ACCESS_TOKEN`];
  const tokenSecret = process.env[`${prefix}_ACCESS_TOKEN_SECRET`];
  if (!key || !secret || !token || !tokenSecret) return null;
  return { key, secret, token, tokenSecret };
}

function signedHeaders(url: string, method: string, c: Creds) {
  const oauth = new OAuth({
    consumer: { key: c.key, secret: c.secret },
    signature_method: "HMAC-SHA1",
    hash_function: (base, k) => crypto.createHmac("sha1", k).update(base).digest("base64"),
  });
  return oauth.toHeader(oauth.authorize({ url, method }, { key: c.token, secret: c.tokenSecret }));
}

async function getJson(url: string, c: Creds): Promise<any> {
  const res = await fetch(url, { headers: { ...signedHeaders(url, "GET", c), "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

// X Snowflake → ms epoch (X epoch = 2010-11-04T01:42:54.657Z)
function snowflakeDate(id: string): string | null {
  try {
    const ms = (BigInt(id) >> 22n) + 1288834974657n;
    const d = new Date(Number(ms));
    const y = d.getUTCFullYear();
    return y > 2015 && y < 2030 ? d.toISOString() : null;
  } catch {
    return null;
  }
}

const NOTES_URL =
  "https://api.x.com/2/notes/search/notes_written?test_mode=false&max_results=100&note.fields=id,status";

for (const prefix of CRED_SETS) {
  const c = loadCreds(prefix);
  console.log(`\n=== ${prefix}_* ===`);
  if (!c) {
    console.log("  (incomplete creds in .env — skipped)");
    continue;
  }
  console.log(`  api_key: ${c.key.slice(0, 6)}…  token: ${c.token.slice(0, 10)}…`);
  try {
    const me = await getJson("https://api.x.com/2/users/me", c);
    console.log(`  users/me: @${me.data?.username} (${me.data?.name})`);
  } catch (e: any) {
    console.log(`  users/me FAILED: ${e.message}`);
  }
  try {
    const notes = await getJson(NOTES_URL, c);
    const arr: any[] = notes.data ?? [];
    const hasMore = Boolean(notes.meta?.next_token);
    const dates = arr.map((n) => snowflakeDate(n.id)).filter(Boolean).sort() as string[];
    const helpful = arr.filter((n) => n.status === "currently_rated_helpful").length;
    console.log(`  notes_written: ${arr.length} on first page${hasMore ? " (+ more pages)" : ""}`);
    if (dates.length) console.log(`  note-id date range (first page): ${dates[0]} … ${dates[dates.length - 1]}`);
    console.log(`  helpful on first page: ${helpful}/${arr.length}`);
  } catch (e: any) {
    console.log(`  notes_written FAILED: ${e.message}`);
  }
}
