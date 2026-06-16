/**
 * Simple Bot — Search Dispatch
 *
 * Routes the search step to a provider-specific helper based on
 * config.web_search. Each helper returns the same shape so the orchestrator
 * doesn't care which provider ran.
 */

import LinkifyIt from "linkify-it";
import { llm } from "../llm/llm";
import { geminiNativeGenerate } from "../llm/gemini";
import { xaiNativeGenerate } from "../llm/xai";
import { WEB_SEARCH_TOOL, GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL, executeToolCall } from "../tool-calling/tools";
import { getBotConfig } from "../ab-testing/botConfig";
import { getMonitoringContext, buildReferenceBlock } from "../misinfo-monitoring/monitoringContext";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost, type TokenCost } from "../cost-tracking/pricing";
import type { LlmCallCost, ToolCallCost } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { ModelOutputInvalidError } from "../utils/errors";
import { stripJsonFences } from "../utils/jsonOutput";

const linkify = new LinkifyIt();

/**
 * Always surface sonar's grounded URLs to the downstream note-writer.
 * Perplexity (and some OpenAI models with web_search_preview) put their
 * grounded URLs in `message.annotations[*].url_citation`; the model only
 * sometimes inlines them in the findings text. Deduplicate against what's
 * already inline, then append the rest under one of two headers:
 *   - "# Citations" if the findings text had no URL at all
 *   - "# Additional Citations" if it had some but not all
 */
function appendSonarCitations(findings: string, annotations: any[] | undefined): string {
  const annotationUrls = (annotations ?? [])
    .filter((a) => a?.type === "url_citation" && typeof a?.url_citation?.url === "string")
    .map((a) => a.url_citation.url as string);
  if (annotationUrls.length === 0) return findings;

  const inlineUrls = new Set((linkify.match(findings) ?? []).map((m) => m.url));
  const missing = annotationUrls.filter((url) => !inlineUrls.has(url));
  if (missing.length === 0) return findings;

  const header = inlineUrls.size > 0 ? "# Additional Citations" : "# Citations";
  return `${findings}\n\n${header}\n${missing.join("\n")}`;
}

// --- Shared prompt + schema ---

const SEARCH_SYSTEM_PROMPT = `You are a research agent for Community Notes fact-checking on X/Twitter.

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

export function getSearchSystemPrompt(): string {
  // Misinfo pre-pass: inject the topic's ground-truth article (covers every
  // simple-bot search provider, since they all build their prompt from here).
  // Treat it as ground truth and cite its Source URL in the findings.
  const monitoring = getMonitoringContext();
  if (!monitoring) return SEARCH_SYSTEM_PROMPT;
  return `${SEARCH_SYSTEM_PROMPT}

A reference document on this post's topic is provided below. Treat it as ground truth and include its Source URL inline in the findings as a citation.

${buildReferenceBlock(monitoring)}`;
}

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

// Prompt-level JSON instruction for providers that can't accept a
// response_format we'd route to: OpenAI's web_search_preview (rejects
// json_schema) and Perplexity Sonar (no endpoint advertises json_schema/
// json_object support, so provider.require_parameters 404s the request).
const PROMPTED_JSON_INSTRUCTION =
  "Respond with strict JSON only matching: { findings: string, correction_needed: boolean }";

// --- Public types ---

export interface SearchDispatchResult {
  findings: string;
  correctionNeeded: boolean;
  costEntry: LlmCallCost;
}

interface SearchOutput {
  findings: string;
  correction_needed: boolean;
}

function parseSearchJson(content: string, source: string): SearchOutput {
  try {
    return JSON.parse(content) as SearchOutput;
  } catch {
    throw new ModelOutputInvalidError(
      `${source}: model output was not valid JSON. content="${content.slice(0, 200)}"`,
    );
  }
}

// --- Dispatcher ---

export async function dispatchSearch(
  userMessage: string,
  costName: string,
): Promise<SearchDispatchResult> {
  const config = getBotConfig();
  switch (config.web_search) {
    case "native":         return searchWithAnthropicNative(userMessage, costName);
    case "native_gemini":  return searchWithGeminiNative(userMessage, costName);
    case "native_grok":    return searchWithGrokNative(userMessage, costName);
    case "native_openai":  return searchWithOpenaiNative(userMessage, costName);
    case "bundled":        return searchWithSonarBundled(userMessage, costName);
    case "searxng":
    case "searxng_summarized":
                           return searchWithSearxngLoop(userMessage, costName);
    case "perplexity":
      throw new Error(`simple-bot search arch "${config.web_search}" not yet implemented`);
  }
}

// --- Helpers ---

async function searchWithAnthropicNative(
  userMessage: string,
  costName: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_model ?? config.model;
  const systemPrompt = getSearchSystemPrompt();
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage });

  const response = await llm.create({
    model,
    messages: [
      // Mark the per-topic-stable system prompt as an Anthropic prefix-cache
      // breakpoint (passed through by OpenRouter). Anthropic doesn't cache
      // automatically and only caches >=1024 tokens, so this is a no-op for the
      // regular pipeline and kicks in when the misinfo reference document is
      // injected — repeated across every post of the same topic.
      {
        role: "system" as const,
        content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      },
      { role: "user" as const, content: userMessage },
    ],
    tools: [WEB_SEARCH_TOOL],
    response_format: OPENAI_RESPONSE_FORMAT,
  } as any);

  const content = response.choices?.[0]?.message?.content ?? "";
  const parsed = parseSearchJson(content, "searchWithAnthropicNative");
  log?.set(`${STEP.search}.messages.1`, { content: parsed });

  const cost = extractOpenRouterCost(response);
  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: { name: costName, ...cost, tools: [] },
  };
}

export async function searchWithGeminiNative(
  userMessage: string,
  costName: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = stripPrefix(config.search_model ?? config.model, "google/");
  const systemPrompt = getSearchSystemPrompt();
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage, model });

  const result = await geminiNativeGenerate({
    model,
    systemInstruction: systemPrompt,
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
  log?.set(`${STEP.search}.messages.1`, {
    content: parsed,
    groundingChunks: result.groundingChunks,
    searchCalls: result.searchCalls,
  });

  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: castCost(costName, result.cost),
  };
}

async function searchWithGrokNative(
  userMessage: string,
  costName: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = stripPrefix(config.search_model ?? config.model, "x-ai/");
  const systemPrompt = getSearchSystemPrompt();
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage, model });

  const result = await xaiNativeGenerate({
    model,
    systemPrompt,
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
  log?.set(`${STEP.search}.messages.1`, { content: parsed, searchCalls: result.searchCalls });

  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: castCost(costName, result.cost),
  };
}

// OpenAI reasoning models (gpt-5*) require max_tokens via OpenRouter (their
// default is 64k+, which OpenRouter rejects unless your credit covers it).
// gpt-5 burns thousands of *reasoning* tokens on top of the visible output,
// so 4000 frequently truncated the response to empty content. 16000 gives
// enough headroom for reasoning + a small JSON answer.
const OPENAI_MAX_TOKENS = 16000;

async function searchWithOpenaiNative(
  userMessage: string,
  costName: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  // OpenRouter passes OpenAI's web_search_preview tool through (verified by
  // the Phase 0 spike), so this is just an llm.create call — no native client.
  const model = config.search_model ?? config.model;
  const systemPrompt = getSearchSystemPrompt();
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage, model });

  // OpenAI's web_search_preview tool via OpenRouter rejects
  // response_format=json_schema (returns 500 on production-sized prompts).
  // Ask for JSON in the prompt and parse the result; gpt-5.x reliably emits
  // valid JSON when explicitly instructed.
  const response = await llm.create({
    model,
    messages: [
      { role: "user" as const, content: `${systemPrompt}\n\n${userMessage}\n\n${PROMPTED_JSON_INSTRUCTION}` },
    ],
    tools: [{ type: "web_search_preview" }] as any,
    max_tokens: OPENAI_MAX_TOKENS,
  } as any);

  const choice = response.choices?.[0];
  const rawContent = choice?.message?.content ?? "";
  const cleaned = stripJsonFences(rawContent);
  if (!cleaned) {
    const finishReason = choice?.finish_reason ?? "unknown";
    const usage = response.usage ? JSON.stringify(response.usage) : "(no usage)";
    throw new ModelOutputInvalidError(
      `searchWithOpenaiNative: empty content. finish_reason=${finishReason} usage=${usage}`,
    );
  }
  const parsed = parseSearchJson(cleaned, "searchWithOpenaiNative");
  log?.set(`${STEP.search}.messages.1`, { content: parsed });

  const cost = extractOpenRouterCost(response);
  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: { name: costName, ...cost, tools: [] },
  };
}

async function searchWithSonarBundled(
  userMessage: string,
  costName: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_model ?? config.model;
  // Perplexity Sonar honors response_format=json_schema, but no Sonar endpoint
  // advertises it, so the global provider.require_parameters routing 404s the
  // request ("No endpoints found that can handle the requested parameters").
  // Ask for JSON in the prompt and parse it instead — Sonar reliably emits
  // valid JSON when instructed.
  const systemPrompt = `${getSearchSystemPrompt()}\n\n${PROMPTED_JSON_INSTRUCTION}`;
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage, model });

  // Sonar models ground the response in web search automatically; no tool needed.
  const response = await llm.create({
    model,
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ],
  } as any);

  const message = response.choices?.[0]?.message;
  const content = stripJsonFences(message?.content ?? "");
  const parsed = parseSearchJson(content, "searchWithSonarBundled");
  const findings = appendSonarCitations(parsed.findings, message?.annotations);
  log?.set(`${STEP.search}.messages.1`, { content: { ...parsed, findings } });

  const cost = extractOpenRouterCost(response);
  return {
    findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: { name: costName, ...cost, tools: [] },
  };
}

const SEARXNG_MAX_TURNS = 6;

/**
 * Tool-calling loop for models without native web search (Kimi, GLM, DeepSeek,
 * Qwen). The model issues google_search calls (which dispatch to SearXNG) and
 * eventually returns the findings as JSON. Reuses executeToolCall from the
 * agent flow rather than forking it.
 */
async function searchWithSearxngLoop(
  userMessage: string,
  costName: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  const model = config.search_model ?? config.model;
  const systemPrompt = `${getSearchSystemPrompt()}

You have access to a google_search tool. Issue search queries to gather evidence, then return your final findings as JSON. You may call google_search multiple times. Stop calling tools and return JSON when you have enough evidence.`;
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage, model });

  const tools = [GOOGLE_SEARCH_TOOL, WEB_FETCH_TOOL];
  const totalCost: TokenCost = emptyTokenCost();
  const toolCosts: ToolCallCost[] = [];

  for (let turn = 1; turn <= SEARXNG_MAX_TURNS; turn++) {
    // Force a tool call on turn 1: without this, some models (DeepSeek v4
    // Flash, observed 2026-05-23) prefer the JSON schema and short-circuit
    // with empty findings + correction_needed=false, never searching.
    //
    // When forcing the tool the model must emit a tool call, not JSON, so the
    // response_format is moot — and some providers (Mistral) reject json_schema
    // unless tool_choice is "auto". Attach the schema only on the "auto" turns.
    const forceToolCall = turn === 1;
    const response = await llm.create({
      model,
      messages,
      tools,
      tool_choice: forceToolCall ? "required" : "auto",
      ...(forceToolCall ? {} : { response_format: OPENAI_RESPONSE_FORMAT }),
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
        log?.set(`${STEP.search}.turn.${turn}.${logKey}`, {
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

    const parsed = parseSearchJson(message.content ?? "", `searxng loop final (turn ${turn})`);
    log?.set(`${STEP.search}.messages.final`, { turn, content: parsed });

    return {
      findings: parsed.findings,
      correctionNeeded: parsed.correction_needed,
      costEntry: { name: costName, ...totalCost, tools: toolCosts },
    };
  }

  // Loop exhausted: some models (e.g. deepseek-v3.2-exp) keep searching past
  // the turn limit without ever producing a final answer on their own. Force
  // synthesis with one more call that has no tools — the model has all the
  // accumulated search results in messages already.
  log?.set(`${STEP.search}.forced_synthesis`, true);
  const finalResp = await llm.create({
    model,
    messages: [
      ...messages,
      {
        role: "user",
        content: "Stop searching. Return your final findings as JSON now.",
      },
    ],
    response_format: OPENAI_RESPONSE_FORMAT,
  } as any);
  addTokenCost(totalCost, extractOpenRouterCost(finalResp));
  const finalContent = finalResp.choices?.[0]?.message?.content ?? "";
  const parsed = parseSearchJson(finalContent, `searxng forced synthesis (after ${SEARXNG_MAX_TURNS} turns)`);
  log?.set(`${STEP.search}.messages.final`, { turn: SEARXNG_MAX_TURNS + 1, content: parsed });
  return {
    findings: parsed.findings,
    correctionNeeded: parsed.correction_needed,
    costEntry: { name: costName, ...totalCost, tools: toolCosts },
  };
}

function stripPrefix(model: string, prefix: string): string {
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

function castCost(name: string, cost: TokenCost): LlmCallCost {
  return { name, ...cost, tools: [] };
}
