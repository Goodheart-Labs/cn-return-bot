/**
 * Simple Bot — Search
 *
 * Single LLM call with Claude's native web_search tool. Returns research findings
 * (with full URLs inline) and a decision on whether a correction is warranted.
 *
 * In a follow-up commit this becomes a thin wrapper around a search dispatcher
 * that routes by config.web_search to multiple providers.
 */

import { WEB_SEARCH_TOOL } from "../tool-calling/tools";
import { getBotConfig } from "../utils/botConfig";
import { trackedLlmCreate, trackLlmCall } from "../utils/costTracker";
import { getTweetLog } from "../utils/tweetLog";

export interface SearchResult {
  findings: string;
  correctionNeeded: boolean;
}

const SYSTEM_PROMPT = `You are a research agent for Community Notes fact-checking on X/Twitter.

Your job: investigate whether the post below contains a factual error that would benefit from a community note. Use the web_search tool to find evidence.

## Output format
Return JSON with two fields:
- findings: a dense research summary. Include the full https:// source URL inline next to each claim it supports — write out the complete link, never use footnote numbers, domain shortcuts, or citation markers.
- correction_needed: true only if the post contains a clear factual error supported by direct contradicting evidence.

## When NOT to set correction_needed = true
- Opinions, satire, jokes, hyperbole
- Posts that are factually correct
- When you can't find strong contradicting evidence
- When the "error" is too minor or pedantic

## Sourcing rules
- Tweets and tweet replies from the comments are valid sources and can be included in the findings (include full x.com URL).
- Include what each source says that's relevant.
- If no correction is needed, the findings can be brief — just explain why.`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "simple_bot_search",
    strict: true,
    schema: {
      type: "object",
      properties: {
        findings: {
          type: "string",
          description: "Research summary with full https:// source URLs inline next to each claim.",
        },
        correction_needed: {
          type: "boolean",
          description: "True iff the post contains a clear factual error worth correcting.",
        },
      },
      required: ["findings", "correction_needed"],
      additionalProperties: false,
    },
  },
};

export async function runSearch(userMessage: string): Promise<SearchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const logPrefix = "simpleBot.search.messages";

  log?.set(`${logPrefix}.0`, { systemPrompt: SYSTEM_PROMPT, userMessage });

  const { response, costEntry } = await trackedLlmCreate("simpleBot.search", {
    model: config.search_model ?? config.model,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
    tools: [WEB_SEARCH_TOOL],
    response_format: RESPONSE_FORMAT,
  } as any);
  trackLlmCall(costEntry);

  const content = response.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { findings: string; correction_needed: boolean };

  log?.set(`${logPrefix}.1`, { content: parsed });

  return { findings: parsed.findings, correctionNeeded: parsed.correction_needed };
}
