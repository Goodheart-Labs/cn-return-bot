/**
 * Simple Bot — Search Dispatch
 *
 * Routes the search step to a provider-specific helper based on
 * config.web_search. Each helper returns the same shape so the orchestrator
 * doesn't care which provider ran.
 */

import { llm } from "../llm/llm";
import { geminiNativeGenerate } from "../llm/gemini";
import { xaiNativeGenerate } from "../llm/xai";
import { WEB_SEARCH_TOOL, GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL, executeToolCall } from "../tool-calling/tools";
import { getBotConfig } from "../utils/botConfig";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost, type TokenCost } from "../utils/pricing";
import type { LlmCallCost, ToolCallCost } from "../utils/costTracker";
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

// Inline JSON schema used by Gemini's responseSchema and as a prompt
// instruction for Grok. Uppercase types follow Gemini's convention.
const INLINE_RESPONSE_SCHEMA = {
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
    case "native_grok":    return searchWithGrokNative(userMessage, name);
    case "native_openai":  return searchWithOpenaiNative(userMessage, name);
    case "bundled":        return searchWithSonarBundled(userMessage, name);
    case "searxng":
    case "searxng_summarized":
                           return searchWithSearxngLoop(userMessage, name);
    case "perplexity":
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
  const model = stripPrefix(config.search_model ?? config.model, "google/");
  log?.set(`${name}.messages.0`, { systemPrompt: SEARCH_SYSTEM_PROMPT, userMessage, model });

  const result = await geminiNativeGenerate({
    model,
    systemInstruction: SEARCH_SYSTEM_PROMPT,
    userMessage,
    enableGoogleSearch: true,
    responseSchema: INLINE_RESPONSE_SCHEMA,
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

async function searchWithGrokNative(
  userMessage: string,
  name: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = stripPrefix(config.search_model ?? config.model, "x-ai/");
  log?.set(`${name}.messages.0`, { systemPrompt: SEARCH_SYSTEM_PROMPT, userMessage, model });

  const result = await xaiNativeGenerate({
    model,
    systemPrompt: SEARCH_SYSTEM_PROMPT,
    userMessage,
    enableXSearch: true,
    responseSchema: INLINE_RESPONSE_SCHEMA,
  });

  if (!result.parsed) {
    throw new Error(
      `Grok did not return parseable JSON. text=${result.text.slice(0, 200)}`,
    );
  }
  const parsed = result.parsed as { findings: string; correction_needed: boolean };
  log?.set(`${name}.messages.1`, { content: parsed, searchCalls: result.searchCalls });

  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: castCost(name, result.cost),
  };
}

// OpenAI reasoning models (gpt-5*) require max_tokens via OpenRouter (their
// default is 64k+, which OpenRouter rejects unless your credit covers it).
// 4000 is a sensible upper bound for findings + reasoning; typical actual
// usage is <500 completion tokens.
const OPENAI_MAX_TOKENS = 4000;

async function searchWithOpenaiNative(
  userMessage: string,
  name: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  // OpenRouter passes OpenAI's web_search_preview tool through (verified by
  // the Phase 0 spike), so this is just an llm.create call — no native client.
  const model = config.search_model ?? config.model;
  log?.set(`${name}.messages.0`, { systemPrompt: SEARCH_SYSTEM_PROMPT, userMessage, model });

  // OpenAI's web_search_preview tool via OpenRouter rejects
  // response_format=json_schema (returns 500 on production-sized prompts).
  // Ask for JSON in the prompt and parse the result; gpt-5.x reliably emits
  // valid JSON when explicitly instructed.
  const promptedSchema = `Respond with strict JSON only matching: { findings: string, correction_needed: boolean }`;
  const response = await llm.create({
    model,
    messages: [
      { role: "user" as const, content: `${SEARCH_SYSTEM_PROMPT}\n\n${userMessage}\n\n${promptedSchema}` },
    ],
    tools: [{ type: "web_search_preview" }] as any,
    max_tokens: OPENAI_MAX_TOKENS,
  } as any);

  const rawContent = response.choices?.[0]?.message?.content ?? "{}";
  const cleaned = rawContent.replace(/^```json\n?|\n?```$/g, "").trim();
  const parsed = JSON.parse(cleaned) as { findings: string; correction_needed: boolean };
  log?.set(`${name}.messages.1`, { content: parsed });

  const cost = extractOpenRouterCost(response);
  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: { name, ...cost, tools: [] },
  };
}

async function searchWithSonarBundled(
  userMessage: string,
  name: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_model ?? config.model;
  log?.set(`${name}.messages.0`, { systemPrompt: SEARCH_SYSTEM_PROMPT, userMessage, model });

  // Sonar models ground the response in web search automatically; no tool needed.
  const response = await llm.create({
    model,
    messages: [
      { role: "system" as const, content: SEARCH_SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ],
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

const SEARXNG_MAX_TURNS = 6;

const SEARXNG_SYSTEM_PROMPT = `${SEARCH_SYSTEM_PROMPT}

You have access to a google_search tool. Issue search queries to gather evidence, then return your final findings as JSON. You may call google_search multiple times. Stop calling tools and return JSON when you have enough evidence.`;

/**
 * Tool-calling loop for models without native web search (Kimi, GLM, DeepSeek,
 * Qwen). The model issues google_search calls (which dispatch to SearXNG) and
 * eventually returns the findings as JSON. Reuses executeToolCall from the
 * agent flow rather than forking it.
 */
async function searchWithSearxngLoop(
  userMessage: string,
  name: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_model ?? config.model;
  const messages: any[] = [
    { role: "system", content: SEARXNG_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
  log?.set(`${name}.messages.0`, { systemPrompt: SEARXNG_SYSTEM_PROMPT, userMessage, model });

  const tools = [GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL];
  const totalCost: TokenCost = emptyTokenCost();
  const toolCosts: ToolCallCost[] = [];

  for (let turn = 1; turn <= SEARXNG_MAX_TURNS; turn++) {
    const response = await llm.create({
      model,
      messages,
      tools,
      response_format: OPENAI_RESPONSE_FORMAT,
    } as any);
    addTokenCost(totalCost, extractOpenRouterCost(response));

    const message = response.choices?.[0]?.message;
    if (!message) {
      throw new Error(`searxng loop: empty response on turn ${turn}`);
    }

    if (message.tool_calls?.length) {
      messages.push(message);
      for (const [i, tc] of message.tool_calls.entries()) {
        const fnName = (tc as any).function?.name ?? "unknown";
        const args = JSON.parse((tc as any).function?.arguments ?? "{}");
        const tStart = Date.now();
        const result = await executeToolCall(fnName, args);
        const tDuration = Date.now() - tStart;

        const logKey = i === 0 ? fnName : `${fnName}_${i}`;
        log?.set(`${name}.turn.${turn}.${logKey}`, {
          args,
          result: result.output,
          durationMs: tDuration,
        });

        if (result.cost) toolCosts.push({ name: logKey, ...result.cost });

        messages.push({
          role: "tool",
          tool_call_id: (tc as any).id,
          content: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
        });
      }
      continue;
    }

    const parsed = JSON.parse(message.content ?? "{}") as {
      findings: string;
      correction_needed: boolean;
    };
    log?.set(`${name}.messages.final`, { turn, content: parsed });

    return {
      findings: parsed.findings,
      correctionNeeded: parsed.correction_needed,
      costEntry: { name, ...totalCost, tools: toolCosts },
    };
  }

  throw new Error(`searxng loop: exhausted ${SEARXNG_MAX_TURNS} turns without final answer`);
}

function stripPrefix(model: string, prefix: string): string {
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

function castCost(name: string, cost: TokenCost): LlmCallCost {
  return { name, ...cost, tools: [] };
}
