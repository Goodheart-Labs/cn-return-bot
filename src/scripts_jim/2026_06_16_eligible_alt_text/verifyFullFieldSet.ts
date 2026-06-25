/**
 * Verify the FULL safe field set (everything except owner-only metrics that
 * 403 on other people's posts) is accepted by the endpoint. Read-only.
 */

import "dotenv/config";
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

const FULL_FIELDS: Record<string, string> = {
  "tweet.fields":
    "article,attachments,author_id,card_uri,community_id,context_annotations,conversation_id,created_at,display_text_range,edit_controls,edit_history_tweet_ids,entities,geo,id,in_reply_to_user_id,lang,matched_media_notes,media_metadata,note_request_suggestions,note_tweet,paid_partnership,possibly_sensitive,public_metrics,referenced_tweets,reply_settings,scopes,source,suggested_source_links,suggested_source_links_with_counts,text,withheld",
  expansions:
    "article.cover_media,article.media_entities,attachments.media_keys,attachments.media_source_tweet,attachments.poll_ids,author_id,edit_history_tweet_ids,entities.mentions.username,geo.place_id,in_reply_to_user_id,referenced_tweets.id,referenced_tweets.id.attachments.media_keys,referenced_tweets.id.author_id",
  "media.fields":
    "alt_text,duration_ms,height,media_key,preview_image_url,public_metrics,type,url,variants,width",
  "user.fields":
    "affiliation,connection_status,created_at,description,entities,id,is_identity_verified,location,most_recent_tweet_id,name,parody,pinned_tweet_id,profile_banner_url,profile_image_url,protected,public_metrics,subscription,subscription_type,url,username,verified,verified_followers_count,verified_type,withheld",
  "poll.fields": "duration_minutes,end_datetime,id,options,voting_status",
  "place.fields": "contained_within,country,country_code,full_name,geo,id,name,place_type",
};

async function main() {
  const params = new URLSearchParams({ ...FULL_FIELDS, max_results: "100", test_mode: "true" });
  const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  const resp = await axios.get(fullUrl, {
    headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
    timeout: 30_000,
  });
  const data = resp.data;
  const posts: any[] = data.data ?? [];

  console.log(`status=${resp.status}  posts=${posts.length}`);
  console.log(`includes: media=${data.includes?.media?.length ?? 0} users=${data.includes?.users?.length ?? 0} tweets=${data.includes?.tweets?.length ?? 0} polls=${data.includes?.polls?.length ?? 0} places=${data.includes?.places?.length ?? 0}`);

  // Union of tweet-level keys actually present across the sample.
  const keys: Record<string, number> = {};
  for (const t of posts) for (const k of Object.keys(t)) keys[k] = (keys[k] ?? 0) + 1;
  console.log(`\ntweet keys seen (count/${posts.length}):`);
  console.log(JSON.stringify(keys, null, 2));

  const userKeys: Record<string, number> = {};
  for (const u of data.includes?.users ?? []) for (const k of Object.keys(u)) userKeys[k] = (userKeys[k] ?? 0) + 1;
  console.log(`\nuser keys seen (count/${data.includes?.users?.length ?? 0}):`);
  console.log(JSON.stringify(userKeys, null, 2));

  if (data.errors?.length) {
    console.log(`\nNON-FATAL errors (${data.errors.length}):`);
    console.log(JSON.stringify(data.errors.slice(0, 5), null, 2));
  }
}

main().catch((err: any) => {
  console.error(`FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
