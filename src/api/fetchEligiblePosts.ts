import axios from "axios";
import { getOAuth1Headers } from "./getOAuthToken";

export type ReferencedTweet = {
  type: "retweeted" | "quoted" | "replied_to";
  id: string;
};

export type ReferencedTweetData = {
  id: string;
  author_id: string;
  created_at: string;
  text: string;
  media?: any[];
};

export type TweetPublicMetrics = {
  impression_count?: number;
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  bookmark_count?: number;
};

export type Post = {
  id: string;
  author_id: string;
  created_at: string;
  // Full post body: note_tweet.text for long-form (>280) posts, else the
  // tweet's text. Never the truncated form.
  text: string;
  media: any[];
  referenced_tweets?: ReferencedTweet[];
  referenced_tweet_data?: ReferencedTweetData;
  public_metrics?: TweetPublicMetrics;
  author_followers?: number;
  author_name?: string;
  author_description?: string;
  author_tweet_count?: number;
  // Named entities X tagged on the post (people, orgs, topics), from
  // context_annotations. Always an array on X-fetched posts (empty when X
  // tagged nothing); optional only because other Post builders omit it.
  entities?: string[];
  // Complete, self-contained X-API tweet object (every field the endpoint
  // returns) with its expansions resolved inline under `includes`. Persisted
  // verbatim to tweets.raw_tweet so no field is ever lost — promote anything
  // that becomes useful to a typed column later. Not read by the bots.
  raw?: RawTweet;
};

// The raw tweet object as returned in `data[]`, augmented with the expansion
// objects this tweet references (so the blob is self-contained). Extra API
// fields beyond the ones we name flow through the index signature untouched.
export type RawTweet = Record<string, unknown> & {
  includes: {
    author: Record<string, unknown> | null;
    media: Record<string, unknown>[];
    referenced_tweets: Record<string, unknown>[];
    polls: Record<string, unknown>[];
    place: Record<string, unknown> | null;
  };
};

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

// Request EVERY field the endpoint exposes, so tweets.raw_tweet captures the
// complete object. Omitted on purpose: non_public_metrics / organic_metrics /
// promoted_metrics (tweet and media) and confirmed_email / receives_your_dm
// (user) — those are owner-only and 403 the whole request on other people's
// posts. `attachments` in tweet.fields is required so referenced
// (quoted/retweeted) tweets carry their attachments.media_keys in
// includes.tweets[]; pairing it with the referenced_tweets.id.attachments.media_keys
// expansion makes X also include those media objects in includes.media[].
// Shared with fetchTweetById so both produce the same Post shape.
export const POST_API_FIELD_PARAMS: Record<string, string> = {
  "tweet.fields":
    "article,attachments,author_id,card_uri,community_id,context_annotations,conversation_id,created_at,display_text_range,edit_controls,edit_history_tweet_ids,entities,geo,id,in_reply_to_user_id,lang,matched_media_notes,media_metadata,note_request_suggestions,note_tweet,paid_partnership,possibly_sensitive,public_metrics,referenced_tweets,reply_settings,scopes,source,suggested_source_links,suggested_source_links_with_counts,text,withheld",
  "media.fields":
    "alt_text,duration_ms,height,media_key,preview_image_url,public_metrics,type,url,variants,width",
  "user.fields":
    "affiliation,connection_status,created_at,description,entities,id,is_identity_verified,location,most_recent_tweet_id,name,parody,pinned_tweet_id,profile_banner_url,profile_image_url,protected,public_metrics,subscription,subscription_type,url,username,verified,verified_followers_count,verified_type,withheld",
  "poll.fields": "duration_minutes,end_datetime,id,options,voting_status",
  "place.fields": "contained_within,country,country_code,full_name,geo,id,name,place_type",
  expansions:
    "article.cover_media,article.media_entities,attachments.media_keys,attachments.media_source_tweet,attachments.poll_ids,author_id,edit_history_tweet_ids,entities.mentions.username,geo.place_id,in_reply_to_user_id,referenced_tweets.id,referenced_tweets.id.attachments.media_keys,referenced_tweets.id.author_id",
};

// tweet.fields that X only accepts on the note-writing eligibility endpoint
// (API_URL). The generic /2/tweets/{id} lookup 400s on them ("not one of ..."),
// so fetchTweetById strips them via singleTweetFieldParams().
const ELIGIBILITY_ONLY_TWEET_FIELDS = ["matched_media_notes", "note_request_suggestions"];

/** POST_API_FIELD_PARAMS with the eligibility-only tweet.fields removed, for the
 *  single-tweet /2/tweets/{id} endpoint (fetchTweetById). */
export function singleTweetFieldParams(): Record<string, string> {
  const drop = new Set(ELIGIBILITY_ONLY_TWEET_FIELDS);
  const tweetFields = POST_API_FIELD_PARAMS["tweet.fields"]!
    .split(",")
    .filter((field) => !drop.has(field))
    .join(",");
  return { ...POST_API_FIELD_PARAMS, "tweet.fields": tweetFields };
}

async function fetchPage(
  maxResults: number,
  postSelection: string | undefined,
  paginationToken: string | undefined
) {
  const params = new URLSearchParams({ ...POST_API_FIELD_PARAMS, test_mode: "false", max_results: String(maxResults) });
  if (postSelection) params.append("post_selection", postSelection);
  if (paginationToken) params.append("pagination_token", paginationToken);

  // OAuth1 requires %20 for spaces; URLSearchParams uses +
  const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;

  return axios.get(fullUrl, {
    headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
    timeout: 30_000,
  });
}

export async function fetchEligiblePosts(
  maxResults: number = 10,
  skipPostIds: Set<string> = new Set(),
  maxPages: number = 3,
  postSelection?: string
): Promise<Post[]> {
  const allEligiblePosts: Post[] = [];
  const seenPostIds = new Set<string>(skipPostIds); // Track all seen post IDs to prevent duplicates
  let nextToken: string | undefined;
  let pageCount = 0;
  let totalDuplicatesSkipped = 0;

  while (pageCount < maxPages && allEligiblePosts.length < maxResults) {
    pageCount++;

    // Fetch more posts than needed to account for skipped ones
    const fetchMultiplier = skipPostIds.size > 0 ? 3 : 1;
    const fetchLimit = Math.min(maxResults * fetchMultiplier, 100);

    const response = await fetchPage(fetchLimit, postSelection, nextToken);

    const allPosts = parsePostsResponse(response.data);

    // Filter out posts that have already been processed or seen
    let pageDuplicates = 0;
    const newPosts = allPosts.filter((post) => {
      if (seenPostIds.has(post.id)) {
        pageDuplicates++;
        return false;
      }
      seenPostIds.add(post.id);
      return true;
    });
    totalDuplicatesSkipped += pageDuplicates;

    // Add new eligible posts to our collection
    allEligiblePosts.push(...newPosts);

    // Get next token for pagination
    nextToken = response.data.meta?.next_token;

    // If no more pages, break
    if (!nextToken) {
      break;
    }
  }

  console.log(
    `[generate] Fetched ${allEligiblePosts.length} eligible posts across ${pageCount} pages (${totalDuplicatesSkipped} duplicates skipped)`
  );

  // Return only the requested number of posts
  return allEligiblePosts.slice(0, maxResults);
}

export function parsePostsResponse(data: any): Post[] {
  const posts: Post[] = [];
  const mediaMap = new Map<string, any>();
  const referencedTweetsMap = new Map<string, any>();
  const userMap = new Map<string, any>();

  if (data.includes?.media) {
    for (const media of data.includes.media) {
      mediaMap.set(media.media_key, media);
    }
  }

  if (data.includes?.tweets) {
    for (const tweet of data.includes.tweets) {
      referencedTweetsMap.set(tweet.id, tweet);
    }
  }

  if (data.includes?.users) {
    for (const user of data.includes.users) {
      userMap.set(user.id, user);
    }
  }

  const pollMap = new Map<string, any>();
  for (const poll of data.includes?.polls ?? []) pollMap.set(poll.id, poll);
  const placeMap = new Map<string, any>();
  for (const place of data.includes?.places ?? []) placeMap.set(place.id, place);

  if (data.data) {
    for (const tweet of data.data) {
      const media = [];
      if (tweet.attachments?.media_keys) {
        for (const mediaKey of tweet.attachments.media_keys) {
          const mediaData = mediaMap.get(mediaKey);
          if (mediaData) {
            media.push({
              media_key: mediaData.media_key,
              type: mediaData.type,
              url: mediaData.url,
              preview_image_url: mediaData.preview_image_url,
              height: mediaData.height,
              width: mediaData.width,
              duration_ms: mediaData.duration_ms,
              view_count: mediaData.public_metrics?.view_count,
              variants: mediaData.variants,
            });
          }
        }
      }
      // Get referenced tweet data if this is a retweet or quoted tweet
      let referencedTweetData: ReferencedTweetData | undefined;
      if (tweet.referenced_tweets?.length > 0) {
        const referencedTweet = tweet.referenced_tweets.find(
          (rt: any) => rt.type === "retweeted" || rt.type === "quoted"
        );
        if (referencedTweet) {
          const referencedData = referencedTweetsMap.get(referencedTweet.id);
          if (referencedData) {
            // Resolve media keys for the referenced tweet
            const refMedia = [];
            if (referencedData.attachments?.media_keys) {
              for (const mediaKey of referencedData.attachments.media_keys) {
                const mediaData = mediaMap.get(mediaKey);
                if (mediaData) {
                  refMedia.push({
                    media_key: mediaData.media_key,
                    type: mediaData.type,
                    url: mediaData.url,
                    preview_image_url: mediaData.preview_image_url,
                    height: mediaData.height,
                    width: mediaData.width,
                    duration_ms: mediaData.duration_ms,
                    view_count: mediaData.public_metrics?.view_count,
                    variants: mediaData.variants,
                  });
                }
              }
            }
            referencedTweetData = {
              id: referencedData.id,
              author_id: referencedData.author_id,
              created_at: referencedData.created_at,
              text: referencedData.text,
              media: refMedia,
            };
          }
        }
      }

      // Extract author follower count from user expansion
      const authorData = userMap.get(tweet.author_id);
      const authorFollowers = authorData?.public_metrics?.followers_count;
      const authorName = authorData?.name;
      const authorDescription = authorData?.description;
      const authorTweetCount = authorData?.public_metrics?.tweet_count;

      // X tags posts with named entities (people, orgs, topics) in context_annotations.
      // The same entity recurs across taxonomy domains, so dedupe by trimmed name.
      const entities = [
        ...new Set<string>(
          (tweet.context_annotations ?? [])
            .map((ca: any) => ca.entity?.name?.trim())
            .filter((name: string | undefined): name is string => Boolean(name)),
        ),
      ];

      posts.push({
        id: tweet.id,
        author_id: tweet.author_id,
        created_at: tweet.created_at,
        // Long-form (>280 char) posts truncate `text` and end it in a t.co
        // self-link; the complete body lives in note_tweet.text. Prefer it so
        // the bots — and tweets.text — see the whole post. The untouched API
        // values are still preserved verbatim in `raw`.
        text: tweet.note_tweet?.text ?? tweet.text,
        media,
        referenced_tweets: tweet.referenced_tweets || undefined,
        referenced_tweet_data: referencedTweetData,
        public_metrics: tweet.public_metrics,
        author_followers: authorFollowers,
        author_name: authorName,
        author_description: authorDescription,
        author_tweet_count: authorTweetCount,
        // Always emit the array (empty when X tagged nothing) so `tweet.post`
        // logs `entities: []` and an absent hint is distinguishable from a
        // dropped field. entityHint() treats [] as "no hint".
        entities,
        raw: buildRawTweet(tweet, mediaMap, userMap, referencedTweetsMap, pollMap, placeMap),
      });
    }
  }
  return posts;
}

// Assemble a self-contained copy of the raw API tweet object: every field X
// returned in data[], plus the expansion objects this tweet references resolved
// inline under `includes` (author user, full media incl. alt_text, referenced
// tweets, polls, place). Stored verbatim in tweets.raw_tweet.
function buildRawTweet(
  tweet: any,
  mediaMap: Map<string, any>,
  userMap: Map<string, any>,
  referencedTweetsMap: Map<string, any>,
  pollMap: Map<string, any>,
  placeMap: Map<string, any>,
): RawTweet {
  const referenced = (tweet.referenced_tweets ?? [])
    .map((rt: any) => referencedTweetsMap.get(rt.id))
    .filter(Boolean);

  // This tweet's own media keys plus those of any referenced tweet.
  const mediaKeys = new Set<string>(tweet.attachments?.media_keys ?? []);
  for (const ref of referenced) {
    for (const key of ref.attachments?.media_keys ?? []) mediaKeys.add(key);
  }

  return {
    ...tweet,
    includes: {
      author: userMap.get(tweet.author_id) ?? null,
      media: [...mediaKeys].map((key) => mediaMap.get(key)).filter(Boolean),
      referenced_tweets: referenced,
      polls: (tweet.attachments?.poll_ids ?? []).map((id: string) => pollMap.get(id)).filter(Boolean),
      place: tweet.geo?.place_id ? placeMap.get(tweet.geo.place_id) ?? null : null,
    },
  };
}
