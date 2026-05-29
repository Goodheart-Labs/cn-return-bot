/**
 * Probe each X credential set in .env: who is it, and can it read the xxl/xl feed?
 * Read-only.
 */
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";
const PREFIXES = ["", "NATHANPMYOUNG_", "JIMMAAR1_", "LOCAL_X_oddcase"]; // "" = default X_*

function applyAccount(prefix: string) {
  // LOCAL uses LOCAL_X_ prefix; others use X_<PREFIX>
  const map: Record<string, string> = {};
  if (prefix === "LOCAL_X_oddcase") {
    map["X_API_KEY"] = "LOCAL_X_API_KEY";
    map["X_API_KEY_SECRET"] = "LOCAL_X_API_KEY_SECRET";
    map["X_ACCESS_TOKEN"] = "LOCAL_X_ACCESS_TOKEN";
    map["X_ACCESS_TOKEN_SECRET"] = "LOCAL_X_ACCESS_TOKEN_SECRET";
  } else {
    map["X_API_KEY"] = `X_${prefix}API_KEY`;
    map["X_API_KEY_SECRET"] = `X_${prefix}API_KEY_SECRET`;
    map["X_ACCESS_TOKEN"] = `X_${prefix}ACCESS_TOKEN`;
    map["X_ACCESS_TOKEN_SECRET"] = `X_${prefix}ACCESS_TOKEN_SECRET`;
  }
  const orig: Record<string, string | undefined> = {};
  for (const [dest, src] of Object.entries(map)) {
    orig[dest] = process.env[dest];
    process.env[dest] = process.env[src];
  }
  return () => {
    for (const [dest, v] of Object.entries(orig)) process.env[dest] = v;
  };
}

async function whoami(): Promise<string> {
  const url = "https://api.twitter.com/2/users/me";
  const res = await axios.get(url, { headers: { ...getOAuth1Headers(url, "GET") }, timeout: 15000 });
  return `@${res.data?.data?.username} (${res.data?.data?.name})`;
}

async function feedProbe(testMode: string): Promise<string> {
  const params = new URLSearchParams({
    "tweet.fields": "created_at",
    test_mode: testMode,
    max_results: "10",
    post_selection: "feed_size: xxl, feed_lang: en",
  });
  const url = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  const res = await axios.get(url, { headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" }, timeout: 20000 });
  return `${res.data?.data?.length ?? 0} posts`;
}

async function main() {
  for (const prefix of PREFIXES) {
    const label = prefix === "" ? "X_* (default)" : prefix === "LOCAL_X_oddcase" ? "LOCAL_X_*" : `X_${prefix}*`;
    const restore = applyAccount(prefix);
    if (!process.env.X_API_KEY) {
      console.log(`\n=== ${label} === (no creds, skip)`);
      restore();
      continue;
    }
    console.log(`\n=== ${label} ===`);
    try {
      console.log(`  whoami: ${await whoami()}`);
    } catch (e: any) {
      console.log(`  whoami FAILED: ${e?.response?.status} ${JSON.stringify(e?.response?.data ?? e?.message)}`);
    }
    for (const tm of ["false", "true"]) {
      try {
        console.log(`  feed(xxl, test_mode=${tm}): ${await feedProbe(tm)}`);
      } catch (e: any) {
        console.log(`  feed(xxl, test_mode=${tm}) FAILED: ${e?.response?.status} ${JSON.stringify(e?.response?.data ?? e?.message)}`);
      }
    }
    restore();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
