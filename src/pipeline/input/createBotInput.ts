/**
 * Bot Input
 *
 * Gathers the inputs that agent-family bots share: the media analysis, the
 * author's note history, and the comments under the post.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { getBotConfig } from "../ab-testing/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { addWarning } from "../utils/warnings";
import { analyzeMediaGemini, type GeminiMediaResult } from "../media/mediaAnalysisGemini";
import { getAuthorNoteHistory, type AuthorNoteHistory } from "./authorHistory";
import { fetchTweetComments } from "./comments";
import { detectMadeWithAiLabel } from "./madeWithAiLabel";
import { readInputCache, writeInputCache, readInputCacheMem, writeInputCacheMem } from "./inputCache";

export interface BotInput {
  mediaResult: GeminiMediaResult;
  authorHistory?: AuthorNoteHistory;
  comments?: string;
  /** X showed a "Made with AI" provenance label on the post's media. */
  mediaMadeWithAiLabel: boolean;
}

const MIN_TEXT_LENGTH_FOR_SEARCH = 20;

/**
 * True when the post has too little text to fact-check on its own, which means
 * the media is the only meaningful signal. The check joins the post's own text
 * with the text of any post it references. It removes @handles and URLs before
 * measuring the length, because neither is something we can search on.
 */
function isMediaOnlyPost(post: Post): boolean {
  const wrapping = post.text ?? "";
  const referenced = post.referenced_tweet_data?.text ?? "";
  const stripped = `${wrapping} ${referenced}`
    .replace(/@\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
  return stripped.length < MIN_TEXT_LENGTH_FOR_SEARCH;
}

export async function createBotInput(post: Post, logTag: string): Promise<BotInput> {
  const config = getBotConfig();
  const strategy = config.video_description_strategy;
  // Try the in-memory cache first, because the note-needed prefilter may have
  // built this input earlier in the same run. Then try the file cache, which only
  // the eval runs ever fill.
  const memCached = readInputCacheMem(post.id, strategy);
  if (memCached) return memCached;
  const cached = readInputCache(post.id, strategy);
  if (cached) {
    writeInputCacheMem(post.id, strategy, cached);
    return cached;
  }

  const log = getTweetLog();

  let mediaResult: GeminiMediaResult = { tweetMedia: [], quotedTweetMedia: [] };
  const hasTweetMedia = post.media?.length > 0;
  const hasQuotedMedia = (post.referenced_tweet_data?.media?.length ?? 0) > 0;
  const hasMedia = hasTweetMedia || hasQuotedMedia;
  const mediaOnly = isMediaOnlyPost(post);

  if (hasMedia) {
    try {
      mediaResult = await analyzeMediaGemini(
        post.media,
        post.referenced_tweet_data?.media,
        config.video_description_strategy,
        post.entities,
      );
    } catch (err: any) {
      const msg = `Media analysis failed: ${err.message}`;
      if (mediaOnly) {
        throw new Error(`${msg} (fatal: media-only tweet has no text to search with)`);
      }
      console.warn(`[${logTag}] ${msg} (continuing without media context)`);
      addWarning(msg);
    }
  }

  // Only media can carry the "Made with AI" label, and the check has to load the
  // post's page in a browser. So we only run it when the post has media, and a
  // text-only post never pays for a page load.
  // Posts from the everything pipeline are synthetic and are given hyphenated ids
  // on purpose, see buildClaimPost. There is no X status page for them, so we skip
  // the check rather than wait out its page-load timeout on every image-backed
  // claim. The check fails open and never blocks note generation.
  const isRealTweetId = /^\d+$/.test(post.id);
  const mediaMadeWithAiLabel = hasMedia && isRealTweetId ? await detectMadeWithAiLabel(post.id, logTag) : false;

  // The author_history A/B test decides whether we look this up at all. When the
  // arm is off we skip the query, and the writer gets no author-history block.
  // A failed lookup is not fatal. We warn and carry on without the history.
  let authorHistory: AuthorNoteHistory | undefined;
  if (config.author_history) {
    try {
      authorHistory = await getAuthorNoteHistory(post.author_id);
    } catch (err: any) {
      console.warn(`[${logTag}] Author history lookup failed: ${err.message}`);
    }
  }

  // The comments are optional. A failed fetch just means the writer sees none.
  let comments: string | undefined;
  try {
    const text = await fetchTweetComments(post.id, post.text);
    comments = text || undefined;
  } catch (err: any) {
    console.warn(`[${logTag}] Comment fetch failed: ${err.message}`);
  }

  log?.set("inputs.author", {
    name: post.author_name,
    description: post.author_description,
    followers: post.author_followers,
    tweetCount: post.author_tweet_count,
    noteHistory: authorHistory ?? null,
  });
  log?.set("inputs.mediaMadeWithAiLabel", mediaMadeWithAiLabel);

  const result: BotInput = { mediaResult, authorHistory, comments, mediaMadeWithAiLabel };
  writeInputCache(post, strategy, result);
  writeInputCacheMem(post.id, strategy, result);
  return result;
}
