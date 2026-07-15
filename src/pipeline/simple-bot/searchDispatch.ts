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
import {
  buildSearchSystemPrompt,
  SEARCH_SYSTEM_PROMPT_CLAIM,
  SEARCH_POLITICAL_SOURCES_INSTRUCTION,
  SEARCH_RESPONSE_FORMAT,
  SEARCH_INLINE_RESPONSE_SCHEMA,
  SEARCH_PROMPTED_JSON_INSTRUCTION,
} from "../prompts/simple-bot/searchAgent";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost, type TokenCost } from "../cost-tracking/pricing";
import type { LlmCallCost, ToolCallCost } from "../cost-tracking/costTracker";
import { getTweetLog } from "../utils/tweetLog";
import { STEP } from "../utils/noteWriterSteps";
import { ModelOutputInvalidError } from "../utils/errors";
import { stripJsonFences, extractJsonObject } from "../utils/jsonOutput";
import { parseJsonWithRetry } from "../utils/jsonLlmCall";

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

/** Resolve the search system prompt for the current run, injecting the misinfo
 *  pre-pass ground-truth article when one is active (covers every simple-bot
 *  search provider, since they all build their prompt from here). */
export function getSearchSystemPrompt(): string {
  const config = getBotConfig();
  // Everything-pipeline claims are an excerpt + a claim, not an X post — use
  // the dedicated claim-check prompt and skip the X-only assembly below.
  if (config.search_claim) return SEARCH_SYSTEM_PROMPT_CLAIM;
  const monitoring = getMonitoringContext();
  const base = buildSearchSystemPrompt({
    referenceBlock: monitoring ? buildReferenceBlock(monitoring) : null,
    simple: config.simple_prompts ?? false,
    antiPedantic: config.search_anti_pedantic ?? false,
  });
  return config.search_political_sources ? base + SEARCH_POLITICAL_SOURCES_INSTRUCTION : base;
}

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

const SEARCH_SCHEMA_HINT = `{ "findings": string, "correction_needed": boolean }`;

/**
 * Shared driver for the prompted-JSON search providers (Anthropic-native,
 * OpenAI-native, Sonar). They all: run one `llm.create` with the search tool,
 * pull the raw text out, and parse `{ findings, correction_needed }` — but with
 * no `response_format` to constrain decoding, the model sometimes answers in
 * prose or doubled/empty JSON. Route the parse through `parseJsonWithRetry` so a
 * bad reply is re-asked (up to 3×) instead of failing the run — the same
 * corrective loop every `response_format` stage already gets via `runJsonLlmCall`.
 * Cost is accumulated across attempts; the successful reply's `message` is
 * returned so Sonar can harvest its `annotations`.
 */
async function dispatchPromptedJsonSearch(params: {
  source: string;
  messages: any[];
  createOptions: Record<string, unknown>;
  /** Raw text → JSON string: `extractJsonObject` for models that narrate a
   *  preamble (Opus), `stripJsonFences` for models that emit bare JSON. */
  extractJson: (raw: string) => string;
}): Promise<{ findings: string; correctionNeeded: boolean; message: any; cost: TokenCost }> {
  const cost = emptyTokenCost();
  let message: any;
  const parsed = await parseJsonWithRetry<SearchOutput>({
    source: params.source,
    messages: params.messages,
    schemaHint: SEARCH_SCHEMA_HINT,
    call: async (messages) => {
      const response = await llm.create({ ...params.createOptions, messages } as any);
      addTokenCost(cost, extractOpenRouterCost(response));
      message = response.choices?.[0]?.message;
      const raw = message?.content ?? "";
      return { toParse: params.extractJson(raw), assistantEcho: raw };
    },
    parse: (toParse) => {
      const output = JSON.parse(toParse) as SearchOutput;
      if (typeof output.findings !== "string" || typeof output.correction_needed !== "boolean") {
        throw new Error("search JSON missing findings/correction_needed");
      }
      return output;
    },
  });
  return { findings: parsed.findings, correctionNeeded: parsed.correction_needed, message, cost };
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
  // Opus 4.8 garbles its output when a server-side web_search tool and a strict
  // json_schema response_format are attached together (Opus-specific collision;
  // Sonnet is unaffected). Drop response_format and ask for JSON in the prompt,
  // then parse it — same workaround as searchWithOpenaiNative / Sonar. Opus emits
  // a reasoning preamble before the JSON, so extract the JSON object rather than
  // parsing the whole message.
  const systemPrompt = `${getSearchSystemPrompt()}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`;
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage });

  const { findings, correctionNeeded, cost } = await dispatchPromptedJsonSearch({
    source: "searchWithAnthropicNative",
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
    createOptions: { model, tools: [WEB_SEARCH_TOOL] },
    extractJson: extractJsonObject,
  });
  log?.set(`${STEP.search}.messages.1`, { content: { findings, correction_needed: correctionNeeded } });

  return { findings, correctionNeeded, costEntry: { name: costName, ...cost, tools: [] } };
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
    responseSchema: SEARCH_INLINE_RESPONSE_SCHEMA,
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
    responseSchema: SEARCH_INLINE_RESPONSE_SCHEMA,
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
  // valid JSON when explicitly instructed. When gpt-5 burns its budget on
  // reasoning and returns empty content, the retry loop re-asks rather than
  // failing the run outright.
  const { findings, correctionNeeded, cost } = await dispatchPromptedJsonSearch({
    source: "searchWithOpenaiNative",
    messages: [
      { role: "user" as const, content: `${systemPrompt}\n\n${userMessage}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}` },
    ],
    createOptions: { model, tools: [{ type: "web_search_preview" }], max_tokens: OPENAI_MAX_TOKENS },
    extractJson: stripJsonFences,
  });
  log?.set(`${STEP.search}.messages.1`, { content: { findings, correction_needed: correctionNeeded } });

  return { findings, correctionNeeded, costEntry: { name: costName, ...cost, tools: [] } };
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
  const systemPrompt = `${getSearchSystemPrompt()}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`;
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage, model });

  // Sonar models ground the response in web search automatically; no tool needed.
  const result = await dispatchPromptedJsonSearch({
    source: "searchWithSonarBundled",
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userMessage },
    ],
    createOptions: { model },
    extractJson: stripJsonFences,
  });
  const findings = appendSonarCitations(result.findings, result.message?.annotations);
  log?.set(`${STEP.search}.messages.1`, { content: { findings, correction_needed: result.correctionNeeded } });

  return {
    findings,
    correctionNeeded: result.correctionNeeded,
    costEntry: { name: costName, ...result.cost, tools: [] },
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
      ...(forceToolCall ? {} : { response_format: SEARCH_RESPONSE_FORMAT }),
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
    response_format: SEARCH_RESPONSE_FORMAT,
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
