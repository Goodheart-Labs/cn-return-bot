/**
 * Researcher Agent
 *
 * Investigates whether a tweet contains a factual error. Uses search tools
 * to find evidence, then writes findings as its final text response.
 */

import type { AgentDef } from "../tool-calling/agentLoop";
import {
  GROK_SEARCH_TOOL,
  PERPLEXITY_SEARCH_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
} from "../tool-calling/tools";
import type { BotConfig } from "../utils/botConfig";
import { getBotConfig } from "../utils/botConfig";

function buildResearcherPrompt(config: BotConfig): string {
  const searchTool = config.web_search === "native"
    ? "web_search: General web search for fact-checking."
    : "perplexity_search: General web search for fact-checking.";

  return `You are a research agent for Community Notes fact-checking on X/Twitter.

Your job: investigate whether the post contains a factual error that would benefit from a community note. If yes, describe what the tweet claims and what's actually true, with full source URLs. If no, explain why.

## Your tools
- grok_search: Search X/Twitter for related tweets, replies, and breaking news. Use 1-3 times.
- ${searchTool}
- web_fetch: Fetch a URL and read its content. Only use for complex research where you need to dig deeper into a specific page.

## Workflow
1. Read the post. Identify the core factual claim(s).
2. Search for evidence using grok_search, ${config.web_search === "native" ? "web_search" : "perplexity_search"}, or both — whichever is appropriate.
3. When you realize that the tweet does not need a correction probably then stop early. Most tweets do not need a correction! 
4. Write your findings as your final text response — the notewriter will receive them directly.

One round of search calls is usually enough. If initial searches don't surface contradicting evidence, conclude rather than searching repeatedly with minor query variations.

## Special cases
- If the tweet plainly contradicts itself (e.g. lies about what's said in its own video), you can immediately write your findings with the tweet URL as the source. No searching needed.
- For AI-generated videos, search for an article discussing AI generation (potentially on this topic) — these make good sources.

## When NOT to correct
- Opinions, satire, jokes, hyperbole
- Posts that are factually correct
- When you can't find strong contradicting evidence
- When the "error" is too minor or pedantic

## Important
- Make it clear whether the tweet needs a correction or not. 
- You are ONLY researching. Do NOT write a community note.
- Your output is free text — be thorough but concise.
- Include full URLs for every source. Tweets and tweet replies are valid sources.
- Include what each source says that's relevant.
- If a tweet doesen't need a correction your response does not need to contain many details.`;
}

export function createResearcherDef(): AgentDef {
  const config = getBotConfig();
  const tools: any[] = [GROK_SEARCH_TOOL];

  tools.push(WEB_FETCH_TOOL);

  if (config.web_search === "native") {
    tools.push(WEB_SEARCH_TOOL);
  } else {
    tools.push(PERPLEXITY_SEARCH_TOOL);
  }

  return {
    name: "researcher",
    description: "Investigates factual claims in tweets using search tools and reports findings.",
    systemPrompt: buildResearcherPrompt(config),
    tools,
    model: config.model,
  };
}

