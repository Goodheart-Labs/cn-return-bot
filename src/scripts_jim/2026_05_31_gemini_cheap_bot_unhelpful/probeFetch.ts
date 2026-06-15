/**
 * Probe the X API /2/tweets/{id} read endpoint with BOTH credential sets
 * (Jim's and Nathan's) against the two target tweets + a control, printing
 * status + body. Lets us tell "X API down" from "these tweets gone" from
 * "this credential tier can't read single tweets".
 */
import "dotenv/config";
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const SUFFIXES = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"];
const PREFIXES = ["X_JIMMAAR1", "X_NATHANPMYOUNG"];

const IDS = [
  "20",                  // @jack's first tweet — control, definitely live
  "2061057696649101483", // LEGO / Bricks & Minifigs
  "2060499990653607980", // NDAA Section 224
];

function applyCreds(prefix: string): boolean {
  if (!SUFFIXES.every((s) => process.env[`${prefix}_${s}`])) return false;
  for (const s of SUFFIXES) process.env[`X_${s}`] = process.env[`${prefix}_${s}`];
  return true;
}

for (const prefix of PREFIXES) {
  if (!applyCreds(prefix)) { console.log(`\n### ${prefix}: not fully set, skipping`); continue; }
  console.log(`\n### ${prefix}`);
  for (const id of IDS) {
    const url = `https://api.x.com/2/tweets/${id}?tweet.fields=created_at,author_id`;
    try {
      const res = await axios.get(url, {
        headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" },
        timeout: 20000,
      });
      const t = res.data?.data?.text ?? "(no text field)";
      console.log(`  [${id}] ${res.status} OK — ${String(t).slice(0, 60).replace(/\n/g, " ")}`);
    } catch (err: any) {
      const status = err?.response?.status ?? err?.code;
      const title = err?.response?.data?.title ?? err?.response?.data?.detail ?? "";
      console.log(`  [${id}] ERROR ${status} ${title}`);
    }
  }
}
