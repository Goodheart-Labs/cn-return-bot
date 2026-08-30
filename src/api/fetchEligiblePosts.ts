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
  // The full body of the post. For long-form posts over 280 characters this is
  // note_tweet.text. For every other post it is the tweet's own text. It is
  // never the truncated form.
  text: string;
  media: any[];
  referenced_tweets?: ReferencedTweet[];
  referenced_tweet_data?: ReferencedTweetData;
  public_metrics?: TweetPublicMetrics;
  author_followers?: number;
  author_name?: string;
  author_description?: string;
  author_tweet_count?: number;
  // The named entities X tagged on the post, such as people, organisations and
  // topics. They come from context_annotations. A post fetched from X always
  // carries an array here, and that array is empty when X tagged nothing. The
  // field is optional only because other places that build a Post leave it out.
  entities?: string[];
  // A complete, self-contained copy of the X API tweet object. It holds every
  // field the endpoint returns, with the expansions resolved inline under
  // `includes`. We store it verbatim in tweets.raw_tweet so that no field is
  // ever lost. If a field turns out to be useful, promote it to a typed column
  // later. The bots never read this.
  raw?: RawTweet;
};

// The raw tweet object as X returns it in `data[]`, together with the expansion
// objects this tweet refers to, so that the blob stands on its own. API fields
// we do not name here still flow through the index signature untouched.
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

// We request every field the endpoint exposes, so that tweets.raw_tweet holds
// the complete object. A few fields are left out on purpose. On the tweet and
// on media those are non_public_metrics, organic_metrics and promoted_metrics.
// On the user they are confirmed_email and receives_your_dm. Only the owner of
// an account may read those, and asking for them makes the whole request fail
// with a 403 on other people's posts.
// `attachments` has to be in tweet.fields, because that is what makes quoted
// and retweeted tweets carry their attachments.media_keys in includes.tweets[].
// Pairing it with the referenced_tweets.id.attachments.media_keys expansion is
// then what makes X put those media objects in includes.media[].
// fetchTweetById uses this same constant, so both paths produce the same Post
// shape.
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

// These tweet.fields only exist on the note-writing eligibility endpoint.
// The generic /2/tweets/{id} lookup rejects the whole request with a 400 when
// they are present, so fetchTweetById strips them via singleTweetFieldParams().
const ELIGIBILITY_ONLY_TWEET_FIELDS = new Set(["matched_media_notes", "note_request_suggestions"]);

/** POST_API_FIELD_PARAMS with the eligibility-only tweet.fields removed, for
 *  the single-tweet /2/tweets/{id} endpoint used by fetchTweetById. */
export function singleTweetFieldParams(): Record<string, string> {
  const tweetFields = POST_API_FIELD_PARAMS["tweet.fields"]!
    .split(",")
    .filter((field) => !ELIGIBILITY_ONLY_TWEET_FIELDS.has(field))
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

  // OAuth1 requires spaces to be encoded as %20, but URLSearchParams encodes
  // them as +, so we swap them back.
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
  const seenPostIds = new Set<string>(skipPostIds);
  let nextToken: string | undefined;
  let pageCount = 0;
  let totalDuplicatesSkipped = 0;

  while (pageCount < maxPages && allEligiblePosts.length < maxResults) {
    pageCount++;

    // Ask X for more posts than we need, because some of them will be skipped.
    const fetchMultiplier = skipPostIds.size > 0 ? 3 : 1;
    const fetchLimit = Math.min(maxResults * fetchMultiplier, 100);

    const response = await fetchPage(fetchLimit, postSelection, nextToken);

    const allPosts = parsePostsResponse(response.data);

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

    allEligiblePosts.push(...newPosts);

    nextToken = response.data.meta?.next_token;

    if (!nextToken) {
      break;
    }

    // Every response reports how much of the endpoint's rate budget is left.
    // The budget is 500 requests per 15 minute window, and every fetch in a run
    // draws on the same budget. We stop before making the request that would be
    // rejected with a 429, rather than reacting once it has failed.
    if (response.headers?.["x-rate-limit-remaining"] === "0") {
      console.warn(
        `[generate] Rate budget exhausted after page ${pageCount}; keeping the ${allEligiblePosts.length} posts already fetched`
      );
      break;
    }
  }

  console.log(
    `[generate] Fetched ${allEligiblePosts.length} eligible posts across ${pageCount} pages (${totalDuplicatesSkipped} duplicates skipped)`
  );

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
      let referencedTweetData: ReferencedTweetData | undefined;
      if (tweet.referenced_tweets?.length > 0) {
        const referencedTweet = tweet.referenced_tweets.find(
          (rt: any) => rt.type === "retweeted" || rt.type === "quoted"
        );
        if (referencedTweet) {
          const referencedData = referencedTweetsMap.get(referencedTweet.id);
          if (referencedData) {
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

      const authorData = userMap.get(tweet.author_id);
      const authorFollowers = authorData?.public_metrics?.followers_count;
      const authorName = authorData?.name;
      const authorDescription = authorData?.description;
      const authorTweetCount = authorData?.public_metrics?.tweet_count;

      // X tags posts with named entities such as people, organisations and
      // topics, and returns them in context_annotations. The same entity comes
      // back once per taxonomy domain, so we remove duplicates by trimmed name.
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
        // Long-form posts over 280 characters have a truncated `text` that ends
        // in a t.co link back to the post itself. Their complete body lives in
        // note_tweet.text, so we prefer that. It is what the bots see, and what
        // is stored in tweets.text. The untouched API values are still kept
        // verbatim in `raw`.
        text: tweet.note_tweet?.text ?? tweet.text,
        media,
        referenced_tweets: tweet.referenced_tweets || undefined,
        referenced_tweet_data: referencedTweetData,
        public_metrics: tweet.public_metrics,
        author_followers: authorFollowers,
        author_name: authorName,
        author_description: authorDescription,
        author_tweet_count: authorTweetCount,
        // We always emit the array, and it is empty when X tagged nothing. That
        // way the `tweet.post` log shows `entities: []`, so a post with no
        // entities looks different from a field we dropped. entityHint() reads
        // an empty array as "no hint".
        entities,
        raw: buildRawTweet(tweet, mediaMap, userMap, referencedTweetsMap, pollMap, placeMap),
      });
    }
  }
  return posts;
}

// Assemble a self-contained copy of the raw API tweet object. It holds every
// field X returned in data[], plus the expansion objects this tweet refers to,
// resolved inline under `includes`. Those are the author, the full media objects
// including their alt_text, the referenced tweets, the polls and the place. The
// result is stored verbatim in tweets.raw_tweet.
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

  // Collect this tweet's own media keys together with those of any tweet it
  // references.
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
