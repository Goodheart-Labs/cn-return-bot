/**
 * One-shot probe to see what X API actually returns for a single tweet fetch
 * using the configured credentials. Prints status, response body, and headers
 * so we can tell auth failure vs quota vs project-tier vs transient 503.
 */

import "dotenv/config";

// Same remap as tryoutNotes.ts — first fully-populated prefix wins, Jim's first.
const X_KEY_PREFIXES = ["X_JIMMAAR1", "X_NATHANPMYOUNG"];
const X_KEY_SUFFIXES = ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"];
for (const prefix of X_KEY_PREFIXES) {
  const allSet = X_KEY_SUFFIXES.every((s) => process.env[`${prefix}_${s}`]);
  if (!allSet) continue;
  for (const suffix of X_KEY_SUFFIXES) {
    process.env[`X_${suffix}`] = process.env[`${prefix}_${suffix}`];
  }
  console.log(`[probe] using ${prefix}`);
  break;
}

import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const TWEET_ID = process.argv[2] ?? "2057499028321861684";

async function main() {
  const params = new URLSearchParams({
    "tweet.fields": "created_at,author_id,referenced_tweets,public_metrics,attachments",
    "media.fields":
      "type,url,preview_image_url,height,width,duration_ms,public_metrics,variants",
    "user.fields": "public_metrics,name,description",
    expansions:
      "attachments.media_keys,referenced_tweets.id,referenced_tweets.id.attachments.media_keys,author_id",
  });
  const url = `https://api.x.com/2/tweets/${TWEET_ID}?${params.toString()}`;

  console.log(`[probe] GET ${url}`);
  console.log(`[probe] X_API_KEY ends in: ...${process.env.X_API_KEY?.slice(-6)}`);
  console.log(`[probe] X_ACCESS_TOKEN ends in: ...${process.env.X_ACCESS_TOKEN?.slice(-6)}`);

  try {
    const resp = await axios.get(url, {
      headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" },
      timeout: 30000,
    });
    console.log(`[probe] status=${resp.status}`);
    console.log(`[probe] body:`, JSON.stringify(resp.data, null, 2));
  } catch (err: any) {
    console.log(`[probe] FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
    if (err.response?.headers) {
      const interesting = ["x-rate-limit-limit", "x-rate-limit-remaining", "x-rate-limit-reset", "x-app-limit-24hour-limit", "x-app-limit-24hour-remaining", "x-app-limit-24hour-reset", "x-user-limit-24hour-limit", "x-user-limit-24hour-remaining"];
      for (const h of interesting) {
        const v = err.response.headers[h];
        if (v) console.log(`[probe] header ${h}: ${v}`);
      }
    }
    if (err.response?.data) {
      console.log(`[probe] body:`, JSON.stringify(err.response.data, null, 2));
    }
  }
}

main();
