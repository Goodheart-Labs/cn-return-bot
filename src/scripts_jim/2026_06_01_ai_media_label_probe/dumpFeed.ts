/**
 * Fetch some posts from the eligible-posts feed and print the FULL raw API response.
 * Uses the prod CN key (the only one enrolled for this endpoint). Forced to
 * test_mode=true because this local key hasn't earned admission for test_mode=false.
 *
 * Usage: bun run src/scripts_jim/2026_06_01_ai_media_label_probe/dumpFeed.ts [count]
 */
import "dotenv/config";

import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";
const COUNT = process.argv[2] ?? "5";

async function main() {
  const params = new URLSearchParams({
    "tweet.fields":
      "created_at,author_id,referenced_tweets,public_metrics,attachments,text,media_metadata,note_tweet,note_request_suggestions,suggested_source_links_with_counts,context_annotations,possibly_sensitive",
    "media.fields":
      "type,url,preview_image_url,height,width,duration_ms,public_metrics,variants,alt_text",
    "user.fields": "public_metrics,name,description",
    expansions:
      "attachments.media_keys,referenced_tweets.id,referenced_tweets.id.attachments.media_keys,author_id",
    max_results: COUNT,
    test_mode: "true",
  });
  const url = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  console.log(`[dumpFeed] using prod X_API_KEY ...${process.env.X_API_KEY?.slice(-6)}`);
  console.log(`[dumpFeed] GET ${url}\n`);

  try {
    const resp = await axios.get(url, {
      headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" },
      timeout: 30000,
    });
    console.log(`[dumpFeed] status=${resp.status}`);
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (err: any) {
    console.log(`[dumpFeed] FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
    if (err.response?.data) console.log(JSON.stringify(err.response.data, null, 2));
  }
}

main();
