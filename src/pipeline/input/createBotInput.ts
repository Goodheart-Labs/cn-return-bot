/**
 * Bot Input
 *
 * Gathers shared inputs (media, author history, comments) for agent-family bots.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import { getBotConfig } from "../utils/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { analyzeMediaGemini, type GeminiMediaResult } from "../media/mediaAnalysisGemini";
import { getAuthorNoteHistory, type AuthorNoteHistory } from "./authorHistory";
import { fetchTweetComments } from "./comments";

export interface BotInput {
  mediaResult: GeminiMediaResult;
  authorHistory?: AuthorNoteHistory;
  comments?: string;
  warnings: string[];
}

const MIN_TEXT_LENGTH_FOR_SEARCH = 20;

/**
 * True if the post has too little text to fact-check on its own — i.e. the
 * media is the only meaningful signal. Combines wrapping + referenced text and
 * strips @handles/URLs before measuring.
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
  const log = getTweetLog();
  const warnings: string[] = [];

  let mediaResult: GeminiMediaResult = { tweetMedia: [], quotedTweetMedia: [] };
  const hasTweetMedia = post.media?.length > 0;
  const hasQuotedMedia = (post.referenced_tweet_data?.media?.length ?? 0) > 0;
  const mediaOnly = isMediaOnlyPost(post);

  if (hasTweetMedia || hasQuotedMedia) {
    try {
      mediaResult = await analyzeMediaGemini(
        post.media,
        post.referenced_tweet_data?.media,
        config.video_description_strategy,
      );
    } catch (err: any) {
      const msg = `Media analysis failed: ${err.message}`;
      if (mediaOnly) {
        throw new Error(`${msg} (fatal: media-only tweet has no text to search with)`);
      }
      console.warn(`[${logTag}] ${msg} (continuing without media context)`);
      warnings.push(msg);
    }
  }

  // Author history (best-effort)
  let authorHistory: AuthorNoteHistory | undefined;
  try {
    authorHistory = await getAuthorNoteHistory(post.author_id);
  } catch (err: any) {
    console.warn(`[${logTag}] Author history lookup failed: ${err.message}`);
  }

  // Comments (best-effort)
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

  return { mediaResult, authorHistory, comments, warnings };
}
