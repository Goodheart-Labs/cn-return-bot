/**
 * The simple bot's search dispatch.
 *
 * It routes the search step to a provider-specific helper, chosen by
 * config.web_search. Every helper returns the same shape, so the orchestrator
 * does not need to know which provider ran.
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
  SEARCH_TIME_TRAVEL_INSTRUCTION,
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
 * Makes sure Sonar's grounded URLs always reach the note writer downstream.
 *
 * Perplexity puts its grounded URLs in `message.annotations[*].url_citation`,
 * and so do some OpenAI models when web_search_preview is on. The model only
 * sometimes repeats those URLs inside the findings text itself. This function
 * drops the ones that are already in that text and appends the rest under a
 * header. The header is "# Citations" when the findings text held no URL at
 * all. It is "# Additional Citations" when the text held some of the URLs but
 * not all of them.
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

/** Builds the search system prompt for the current run. When a misinfo
 *  monitoring topic is active, that topic's reference document is injected into
 *  the prompt. Every simple-bot search provider builds its prompt here, so they
 *  all get the same treatment. */
export function getSearchSystemPrompt(): string {
  const config = getBotConfig();
  // A claim from the everything pipeline is an excerpt plus a claim, not an X
  // post. It gets its own claim-checking prompt and skips the X-only assembly
  // below.
  if (config.search_claim) return SEARCH_SYSTEM_PROMPT_CLAIM;
  const monitoring = getMonitoringContext();
  let prompt = buildSearchSystemPrompt({
    referenceBlock: monitoring ? buildReferenceBlock(monitoring) : null,
  });
  if (config.time_travel_prompt) prompt += SEARCH_TIME_TRAVEL_INSTRUCTION;
  if (config.search_political_sources) prompt += SEARCH_POLITICAL_SOURCES_INSTRUCTION;
  return prompt;
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
 * The shared driver for the search providers that ask for JSON in the prompt.
 * Those are the Anthropic-native path, the OpenAI-native path, and Sonar.
 *
 * They all do the same thing. They run one `llm.create` with the search tool,
 * pull the raw text out of the reply, and parse
 * `{ findings, correction_needed }` from it. None of them can pass a
 * `response_format` to constrain the decoding, so the model sometimes answers
 * in prose, or with doubled or empty JSON. The parse therefore goes through
 * `parseJsonWithRetry`, which re-asks the model up to three times before it
 * gives up instead of failing the run on the first bad reply. That is the same
 * corrective loop every `response_format` stage already gets through
 * `runJsonLlmCall`.
 *
 * The cost of every attempt is added up. The `message` of the successful reply
 * is returned as well, so the Sonar path can read its `annotations`.
 */
async function dispatchPromptedJsonSearch(params: {
  source: string;
  messages: any[];
  createOptions: Record<string, unknown>;
  /** Turns the raw reply text into the JSON string to parse. Use
   *  `extractJsonObject` for a model that narrates a preamble first, such as
   *  Opus. Use `stripJsonFences` for a model that emits bare JSON. */
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
  // json_schema response_format are attached at the same time. The collision is
  // specific to Opus. Sonnet is not affected. So we drop the response_format,
  // ask for JSON in the prompt, and parse it ourselves. searchWithOpenaiNative
  // and the Sonar path use the same workaround. Opus writes a reasoning
  // preamble before the JSON, so we extract the JSON object instead of parsing
  // the whole message.
  const systemPrompt = `${getSearchSystemPrompt()}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`;
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage });

  const { findings, correctionNeeded, cost } = await dispatchPromptedJsonSearch({
    source: "searchWithAnthropicNative",
    messages: [
      // This marks the system prompt as an Anthropic prefix-cache breakpoint,
      // which OpenRouter passes through. The prompt stays the same across every
      // post of a topic. Anthropic never caches on its own, and it only caches
      // prompts of at least 1024 tokens. So this does nothing for the regular
      // pipeline. It starts to pay off once the misinfo reference document is
      // injected, because that long prompt then repeats on every post of the
      // topic.
      {
        role: "system" as const,
        content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      },
      { role: "user" as const, content: userMessage },
    ],
    createOptions: {
      model,
      tools: [WEB_SEARCH_TOOL],
      ...(config.search_reasoning_effort ? { reasoning_effort: config.search_reasoning_effort } : {}),
    },
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

// OpenAI's reasoning models, the gpt-5 family, need an explicit max_tokens when
// they are called through OpenRouter. Their own default is over 64k, and
// OpenRouter rejects that unless your credit covers it. A gpt-5 model also burns
// thousands of reasoning tokens on top of the visible output, so a limit of 4000
// often truncated the reply to empty content. 16000 leaves room for the
// reasoning and a small JSON answer.
const OPENAI_MAX_TOKENS = 16000;

async function searchWithOpenaiNative(
  userMessage: string,
  costName: string,
): Promise<SearchDispatchResult> {
  const log = getTweetLog();
  const config = getBotConfig();
  // OpenRouter passes OpenAI's web_search_preview tool straight through. The
  // Phase 0 spike verified that. So a plain llm.create call is enough here and
  // we need no native OpenAI client.
  const model = config.search_model ?? config.model;
  const systemPrompt = getSearchSystemPrompt();
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage, model });

  // Called through OpenRouter, OpenAI's web_search_preview tool rejects
  // response_format=json_schema. It returns a 500 on production-sized prompts.
  // So we ask for JSON in the prompt and parse the reply. A gpt-5.x model emits
  // valid JSON reliably when it is told to. If gpt-5 spends its whole budget on
  // reasoning and returns empty content, the retry loop asks again instead of
  // failing the run.
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
  // Perplexity Sonar does honour response_format=json_schema, but no Sonar
  // endpoint advertises that it does. Our global provider.require_parameters
  // routing therefore 404s the request with "No endpoints found that can handle
  // the requested parameters". So we ask for JSON in the prompt and parse it
  // ourselves. Sonar emits valid JSON reliably when it is told to.
  const systemPrompt = `${getSearchSystemPrompt()}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`;
  log?.set(`${STEP.search}.messages.0`, { systemPrompt, userMessage, model });

  // Sonar models ground their answer in a web search on their own, so we attach
  // no search tool here.
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
 * The tool-calling loop for models that have no native web search, such as
 * Kimi, GLM, DeepSeek, and Qwen. The model issues google_search calls, which we
 * dispatch to SearXNG, and eventually returns its findings as JSON. It reuses
 * executeToolCall from the agent flow rather than forking it.
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
    // Turn 1 forces a tool call. Without that, some models prefer the JSON
    // schema and stop straight away with empty findings and
    // correction_needed=false, without ever searching. We saw DeepSeek v4 Flash
    // do this on 2026-05-23.
    //
    // On a forced turn the model has to emit a tool call rather than JSON, so
    // the response_format would have no effect anyway. Some providers, Mistral
    // among them, also reject json_schema unless tool_choice is "auto". So we
    // attach the schema only on the turns that use "auto".
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

  // The loop ran out of turns. Some models, deepseek-v3.2-exp for one, keep
  // searching past the turn limit and never produce a final answer on their
  // own. One more call with no tools attached forces them to write one. Every
  // search result they gathered is already in the message list.
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
