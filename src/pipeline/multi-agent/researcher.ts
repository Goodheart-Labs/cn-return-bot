/**
 * Researcher Agent
 *
 * Investigates whether a tweet contains a factual error. Uses search tools
 * to find evidence, then sends findings to the notewriter via send_message.
 */

import type { AgentDef } from "./agentFramework";
import { buildSendMessageTool } from "./agentFramework";
import {
  GROK_SEARCH_TOOL,
  PERPLEXITY_SEARCH_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  NO_CORRECTION_TOOL,
} from "../tool-calling/tools";
import type { BotConfig } from "../agent/agentConfig";
import type { GeminiMediaItem } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "../input/authorHistory";
import { buildUserMessage } from "../agent/agentPrompt";

const SYSTEM_PROMPT = `You are a research agent for Community Notes fact-checking on X/Twitter.

Your job: investigate whether the post contains a factual error that would benefit from a community note. If yes, describe what the tweet claims and what's actually true, with full source URLs. If no, explain why.

## Your tools
- grok_search: Search X/Twitter for related tweets, replies, and breaking news. Use 1-3 times.
- web_search / perplexity_search: General web search for fact-checking.
- web_fetch: Fetch a URL and read its content. Only use for complex research where you need to dig deeper into a specific page. Do NOT use just to verify sources before citing — the source verifier handles that.
- send_message: Send your findings to the notewriter.
- no_correction_needed: Call when no correction is warranted, or when you can't find sufficient evidence.

## Workflow
1. Read the post. Identify the core factual claim(s).
2. Search for evidence using grok_search, web_search, or both — whichever is appropriate.

In most cases, one round of search calls is enough — search, read the results, send findings. Only do additional searches for genuinely complex claims.

## Special cases
- If the tweet plainly contradicts itself (e.g. lies about what's said in its own video), you can immediately send findings to the notewriter with the tweet URL as the source. No searching needed.
- For AI-generated videos, search for an article discussing AI generation (potentially on this topic) — these make good sources.

## When NOT to correct
- Opinions, satire, jokes, hyperbole
- Posts that are factually correct
- When you can't find strong contradicting evidence
- When the "error" is too minor or pedantic

## Important
- You are ONLY researching. Do NOT write a community note.
- Your output is free text — be thorough but concise.
- Include full URLs for every source. Tweets and tweet replies are valid sources.
- Include what each source says that's relevant.`;

export function createResearcherDef(
  config: BotConfig,
  agentDescriptions: string,
): AgentDef {
  const tools: any[] = [GROK_SEARCH_TOOL, WEB_FETCH_TOOL];

  if (config.search_mode === "native-search") {
    tools.push(WEB_SEARCH_TOOL);
  } else {
    tools.push(PERPLEXITY_SEARCH_TOOL);
  }

  tools.push(buildSendMessageTool(["notewriter"]));
  tools.push(NO_CORRECTION_TOOL);

  return {
    name: "researcher",
    description:
      "Investigates factual claims in tweets using search tools and reports findings.",
    systemPrompt: SYSTEM_PROMPT + `\n\n## Other agents\n${agentDescriptions}`,
    tools,
    terminalTools: ["send_message", "no_correction_needed"],
    model: config.model,
  };
}

export function buildResearcherFirstMessage(params: {
  tweetText: string;
  tweetId: string;
  tweetDate: string;
  quotedPostText?: string;
  tweetMedia: GeminiMediaItem[];
  quotedTweetMedia: GeminiMediaItem[];
  authorName?: string;
  authorDescription?: string;
  authorFollowers?: number;
  authorTweetCount?: number;
  authorNoteHistory?: AuthorNoteHistory;
  comments?: string;
}): string {
  const now = new Date();
  return buildUserMessage({
    ...params,
    currentDate: now.toISOString().split("T")[0]!,
    currentTime: now.toISOString().split("T")[1]!.slice(0, 5),
  });
}
