/**
 * Bot Input
 *
 * Gathers shared inputs (media, author history, comments) for agent-family bots.
 */

import type { PostContent } from "../../bots/types";
import type { BotConfig } from "../agent/agentConfig";
import { analyzeMediaGemini, type GeminiMediaResult } from "../media/mediaAnalysisGemini";
import { emptyTokenCost, addTokenCost, type TokenCost } from "../utils/pricing";
import { getAuthorNoteHistory, type AuthorNoteHistory } from "./authorHistory";
import { fetchTweetComments } from "./comments";

export interface BotInput {
  mediaResult: GeminiMediaResult;
  authorHistory?: AuthorNoteHistory;
  comments?: string;
  mediaCost: TokenCost;
  warnings: string[];
}

export async function createBotInput(
  post: any,
  content: PostContent,
  config: BotConfig,
  logTag: string,
): Promise<BotInput> {
  const warnings: string[] = [];

  // Media analysis (fatal for media-only tweets)
  let mediaResult: GeminiMediaResult = { tweetMedia: [], quotedTweetMedia: [], cost: emptyTokenCost() };
  const hasTweetMedia = post.media?.length > 0;
  const hasQuotedMedia = post.referenced_tweet_data?.media?.length > 0;

  if (hasTweetMedia || hasQuotedMedia) {
    try {
      mediaResult = await analyzeMediaGemini(
        post.media,
        post.referenced_tweet_data?.media,
        config.video_description_strategy,
      );
    } catch (err: any) {
      const msg = `Media analysis failed: ${err.message}`;
      const strippedText = content.text.replace(/@\w+/g, "").replace(/https?:\/\/\S+/g, "").trim();
      if (strippedText.length < 20) {
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
  const mediaCost = { ...mediaResult.cost };
  try {
    const commentsResult = await fetchTweetComments(post.id, content.text);
    comments = commentsResult.comments || undefined;
    addTokenCost(mediaCost, commentsResult.cost);
  } catch (err: any) {
    console.warn(`[${logTag}] Comment fetch failed: ${err.message}`);
  }

  return { mediaResult, authorHistory, comments, mediaCost, warnings };
}
