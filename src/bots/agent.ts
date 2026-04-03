/**
 * Agent Bot
 *
 * Agentic bot using Claude 4.6 Opus with tool calling.
 * Replaces the sequential search -> write -> verify pipeline with a single
 * agentic call that decides its own workflow.
 *
 * A/B tests search mode (native web search vs Perplexity) via config flags.
 * Bot name in DB includes flag values: e.g. "agent_native-search".
 */

import { Bot, PipelineResult } from "./types";
import { randomizeConfig, withAgentConfig, deriveBotName } from "../pipeline/agent/agentConfig";
import { analyzeMediaGemini, type GeminiMediaResult } from "../pipeline/media/mediaAnalysisGemini";
import { getAuthorNoteHistory, type AuthorNoteHistory } from "../pipeline/agent/agentAuthorHistory";
import { runToolCallingLoop } from "../pipeline/agent/toolCallingLoop";

export const agentBot: Bot = {
  id: "agent",
  name: "Agent (Opus 4.6)",
  description: "Agentic bot using Claude 4.6 Opus with tool calling",
  weight: 10000,

  async runPipeline(post, content): Promise<PipelineResult | null> {
    const config = randomizeConfig();

    return withAgentConfig(config, async () => {
      const warnings: string[] = [];

      // 1. Media analysis with Gemini 3 Flash (separate tweet + quoted tweet media)
      let mediaResult: GeminiMediaResult = { tweetMedia: [], quotedTweetMedia: [] };
      const hasTweetMedia = post.media?.length > 0;
      const hasQuotedMedia = post.referenced_tweet_data?.media?.length > 0;

      if (hasTweetMedia || hasQuotedMedia) {
        try {
          mediaResult = await analyzeMediaGemini(
            post.media,
            post.referenced_tweet_data?.media,
          );
        } catch (err: any) {
          const msg = `Media analysis failed: ${err.message}`;
          const strippedText = content.text.replace(/@\w+/g, "").replace(/https?:\/\/\S+/g, "").trim();
          if (strippedText.length < 20) {
            throw new Error(`${msg} (fatal: media-only tweet has no text to search with)`);
          }
          console.warn(`[agent] ${msg} (continuing without media context)`);
          warnings.push(msg);
        }
      }

      // 2. Author note history (best-effort, non-fatal)
      let authorHistory: AuthorNoteHistory | undefined;
      try {
        authorHistory = await getAuthorNoteHistory(post.author_id);
      } catch (err: any) {
        console.warn(`[agent] Author history lookup failed: ${err.message}`);
      }

      // 3. Run the tool-calling loop
      const result = await runToolCallingLoop(post, content, config, mediaResult, authorHistory);
      result.botId = deriveBotName("agent", config);

      if (warnings.length && !result.warnings) {
        result.warnings = warnings;
      } else if (warnings.length) {
        result.warnings!.push(...warnings);
      }

      return result;
    });
  },
};
