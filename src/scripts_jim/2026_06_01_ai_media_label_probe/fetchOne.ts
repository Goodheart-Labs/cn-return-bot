/**
 * Fetch ONE specific tweet that carries X's UI "Made with AI" label and dump the
 * full API response — does media_metadata (or anything) expose that label?
 * Uses Jim's standard Project app (the prod CN app 403s on /2/tweets).
 */
import "dotenv/config";

for (const suffix of ["API_KEY", "API_KEY_SECRET", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET"]) {
  const v = process.env[`X_JIMMAAR1_${suffix}`];
  if (v) process.env[`X_${suffix}`] = v;
}

import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const TWEET_ID = process.argv[2] ?? "2061173772149719137";

async function main() {
  const params = new URLSearchParams({
    "tweet.fields":
      "created_at,author_id,attachments,text,media_metadata,possibly_sensitive,edit_history_tweet_ids,source,note_tweet,context_annotations",
    "media.fields":
      "type,url,preview_image_url,height,width,duration_ms,public_metrics,variants,alt_text",
    expansions: "attachments.media_keys,author_id",
  });
  const url = `https://api.x.com/2/tweets/${TWEET_ID}?${params.toString().replace(/\+/g, "%20")}`;
  console.log(`[fetchOne] using X_API_KEY ...${process.env.X_API_KEY?.slice(-6)}`);
  console.log(`[fetchOne] GET ${url}`);
  try {
    const resp = await axios.get(url, {
      headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" },
      timeout: 30000,
    });
    console.log(`[fetchOne] status=${resp.status}`);
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (err: any) {
    console.log(`[fetchOne] FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
    if (err.response?.data) console.log(JSON.stringify(err.response.data, null, 2));
  }
}

main();
