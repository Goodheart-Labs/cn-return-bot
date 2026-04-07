/**
 * Multi-Agent Bot
 *
 * Three-stage pipeline: Researcher → Notewriter → Source Verifier.
 * All agents use Claude Sonnet 4.6. Messages persist across turns.
 */

import { Bot, PipelineResult } from "./types";
import { randomizeConfig, withBotConfig, deriveBotName } from "../pipeline/agent/agentConfig";
import { analyzeMediaGemini } from "../pipeline/media/mediaAnalysisGemini";
import { emptyTokenCost, addTokenCost } from "../pipeline/agent/agentPricing";
import { getAuthorNoteHistory, type AuthorNoteHistory } from "../pipeline/agent/agentAuthorHistory";
import { fetchTweetComments } from "../pipeline/agent/agentComments";
import { runMultiAgentPipeline } from "../pipeline/multi-agent/orchestrator";

export const multiAgentBot: Bot = {
  id: "multi-agent",
  name: "Multi-Agent (Sonnet 4.6)",
  description: "Researcher → Notewriter → Source Verifier pipeline using Claude Sonnet 4.6",
  weight: 50,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    const { config, variantName } = randomizeConfig();

    return withBotConfig(config, async () => {
      const warnings: string[] = [];

      // 1. Media analysis with Gemini (separate tweet + quoted tweet media)
      let mediaResult = { tweetMedia: [] as any[], quotedTweetMedia: [] as any[], cost: emptyTokenCost() };
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
          console.warn(`[multi-agent] ${msg} (continuing without media context)`);
          warnings.push(msg);
        }
      }

      // 2. Author note history (best-effort)
      let authorHistory: AuthorNoteHistory | undefined;
      try {
        authorHistory = await getAuthorNoteHistory(post.author_id);
      } catch (err: any) {
        console.warn(`[multi-agent] Author history lookup failed: ${err.message}`);
      }

      // 3. Fetch comments/replies via Grok (best-effort)
      let comments: string | undefined;
      const totalMediaCost = { ...mediaResult.cost };
      try {
        const commentsResult = await fetchTweetComments(post.id, content.text);
        comments = commentsResult.comments || undefined;
        addTokenCost(totalMediaCost, commentsResult.cost);
      } catch (err: any) {
        console.warn(`[multi-agent] Comment fetch failed: ${err.message}`);
      }

      // 4. Run multi-agent pipeline
      const result = await runMultiAgentPipeline(
        post, content, config, mediaResult, authorHistory, totalMediaCost, comments,
      );
      result.botId = deriveBotName("multi-agent", variantName);

      if (warnings.length && !result.warnings) {
        result.warnings = warnings;
      } else if (warnings.length) {
        result.warnings!.push(...warnings);
      }

      return result;
    });
  },
};
