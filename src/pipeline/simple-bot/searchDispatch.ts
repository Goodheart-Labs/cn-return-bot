/**
 * Simple Bot — Search Dispatch
 *
 * Routes the search step to a provider-specific helper based on
 * config.web_search. Each helper returns the same shape so the orchestrator
 * doesn't care which provider ran.
 */

import { llm } from "../llm/llm";
import { geminiNativeGenerate } from "../llm/gemini";
import { WEB_SEARCH_TOOL } from "../tool-calling/tools";
import { getBotConfig } from "../utils/botConfig";
import { extractOpenRouterCost, type TokenCost } from "../utils/pricing";
import type { LlmCallCost } from "../utils/costTracker";
import { getTweetLog } from "../utils/tweetLog";

// --- Shared prompt + schema ---

export const SEARCH_SYSTEM_PROMPT = `You are a research agent for Community Notes fact-checking on X/Twitter.

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

// OpenAI-flavoured schema (strict json_schema), used by Anthropic via OpenRouter.
const OPENAI_RESPONSE_FORMAT = {
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

// Gemini-flavoured schema (uppercase types).
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    findings: { type: "STRING" },
    correction_needed: { type: "BOOLEAN" },
  },
  required: ["findings", "correction_needed"],
};

// --- Public types ---

export interface SearchDispatchResult {
  findings: string;
  correctionNeeded: boolean;
  costEntry: LlmCallCost;
}

// --- Dispatcher ---

export async function dispatchSearch(
  userMessage: string,
  name: string,
): Promise<SearchDispatchResult> {
  const config = getBotConfig();
  switch (config.web_search) {
    case "native":         return searchWithAnthropicNative(userMessage, name);
    case "native_gemini":  return searchWithGeminiNative(userMessage, name);
    case "native_grok":
    case "native_openai":
    case "bundled":
    case "perplexity":
    case "searxng":
    case "searxng_summarized":
      throw new Error(`simple-bot search arch "${config.web_search}" not yet implemented`);
  }
}

// --- Helpers ---

async function searchWithAnthropicNative(
  userMessage: string,
  name: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_model ?? config.model;
  log?.set(`${name}.messages.0`, { systemPrompt: SEARCH_SYSTEM_PROMPT, userMessage });

  const response = await llm.create({
    model,
    messages: [
      { role: "system" as const, content: SEARCH_SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
    tools: [WEB_SEARCH_TOOL],
    response_format: OPENAI_RESPONSE_FORMAT,
  } as any);

  const content = response.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { findings: string; correction_needed: boolean };
  log?.set(`${name}.messages.1`, { content: parsed });

  const cost = extractOpenRouterCost(response);
  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: { name, ...cost, tools: [] },
  };
}

async function searchWithGeminiNative(
  userMessage: string,
  name: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = stripGooglePrefix(config.search_model ?? config.model);
  log?.set(`${name}.messages.0`, { systemPrompt: SEARCH_SYSTEM_PROMPT, userMessage, model });

  const result = await geminiNativeGenerate({
    model,
    systemInstruction: SEARCH_SYSTEM_PROMPT,
    userMessage,
    enableGoogleSearch: true,
    responseSchema: GEMINI_RESPONSE_SCHEMA,
  });

  if (!result.parsed) {
    throw new Error(
      `Gemini did not return parseable JSON. text=${result.text.slice(0, 200)}`,
    );
  }
  const parsed = result.parsed as { findings: string; correction_needed: boolean };
  log?.set(`${name}.messages.1`, {
    content: parsed,
    groundingChunks: result.groundingChunks,
    searchCalls: result.searchCalls,
  });

  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: castCost(name, result.cost),
  };
}

function stripGooglePrefix(model: string): string {
  return model.startsWith("google/") ? model.slice("google/".length) : model;
}

function castCost(name: string, cost: TokenCost): LlmCallCost {
  return { name, ...cost, tools: [] };
}
