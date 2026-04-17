/**
 * Researcher Agent
 *
 * Investigates factual claims in a tweet using search tools and reports
 * findings as free text. Does NOT decide whether a note is needed — that's
 * the job of the note-needed judge downstream.
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

Your job: investigate the factual claims in the post and report what you found. Describe what the tweet claims and what the evidence says, with full source URLs.

A downstream judge will decide whether a Community Note is actually warranted — you just need to surface the evidence clearly.

## Your tools
- grok_search: Search X/Twitter for related tweets, replies, and breaking news. Use 1-3 times.
- ${searchTool}
- web_fetch: Fetch a URL and read its content. Only use for complex research where you need to dig deeper into a specific page.

## Workflow
1. Read the post. Identify the core factual claim(s).
2. Search for evidence using grok_search, ${config.web_search === "native" ? "web_search" : "perplexity_search"}, or both — whichever is appropriate.
3. Write your findings as your final text response.

One round of search calls is usually enough. If initial searches don't surface relevant evidence, conclude rather than searching repeatedly with minor query variations. You can also stop early when the post is plainly opinion/satire/hyperbole and no search is needed.

## Special cases
- If the tweet plainly contradicts itself (e.g. lies about what's in its own video), you can immediately write findings citing the tweet URL. No searching needed.
- For AI-generated videos, search for an article discussing AI generation on this topic — these make good sources.

## Important
- You are ONLY researching. Do NOT write a community note.
- Your output is free text — concise but complete enough for the judge and notewriter to work from.
- Include full URLs for every source. Tweets and tweet replies are valid sources.
- Summarize what each source says that's relevant.
- If the post is opinion/satire or you found no contradicting evidence, say so explicitly and keep the response short.`;
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
