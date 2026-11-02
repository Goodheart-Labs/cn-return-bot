/* The connection to OpenAI, and the wrapper that records every request.
 *
 * Every request goes straight to OpenAI's Responses API, not through
 * OpenRouter, because the flex tier, the hosted web search and the cache
 * settings are OpenAI's own. The wrapper keeps each agent's last request and
 * answer, which the fork tool copies, and logs what each request cost. */

import type { AgentInputItem, AgentOutputItem, Model, ModelRequest, ModelResponse } from "@openai/agents";
import { OpenAIResponsesModel } from "@openai/agents";
import OpenAI from "openai";
import { LONG_CONTEXT_INPUT_TOKENS, MODEL, requestCostUsd, type RequestUsage, type ServiceTier } from "./pricing";

/** OpenAI's advice for flex: a flex request may wait a long time for a free
 *  machine, so the client waits up to 15 minutes for an answer. */
const REQUEST_TIMEOUT_MS = 15 * 60_000;
/** The OpenAI client retries a busy answer (HTTP 429, which flex gives when
 *  OpenAI has no capacity) and server errors this often, with growing waits.
 *  After that the run fails. It does not fall back to the dearer standard
 *  tier. */
const MAX_RETRIES = 6;

/** The examples stay in OpenAI's cache this long after each use. Posts come
 *  about once an hour, so the shorter 30-minute lifetime would often expire
 *  between two posts. */
const EXAMPLES_CACHE_TTL = "12h";

/** The Agents SDK (0.21.0) sends a system message as plain text and cannot put
 *  a cache breakpoint on it. A breakpoint marks the end of a prefix that
 *  OpenAI stores in its cache, and only a stored prefix can be read by a later
 *  request. Without one at the end of the examples, two posts would share no
 *  cached tokens, because they differ right after the examples.
 *  So the harness sends the examples as the first message with the role
 *  "system", and this rewrites that message into a developer message (OpenAI's
 *  name for the system prompt) whose text carries the breakpoint. */
export function addExamplesBreakpoint(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.input)) return body;
  const [first, ...rest] = body.input as { role?: string; content?: unknown }[];
  if (first?.role !== "system" || typeof first.content !== "string") return body;
  const examples = {
    role: "developer",
    content: [{ type: "input_text", text: first.content, prompt_cache_breakpoint: { mode: "explicit", ttl: EXAMPLES_CACHE_TTL } }],
  };
  return { ...body, input: [examples, ...rest] };
}

async function fetchWithExamplesBreakpoint(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (typeof init?.body !== "string" || !String(url).endsWith("/responses")) return fetch(url, init);
  return fetch(url, { ...init, body: JSON.stringify(addExamplesBreakpoint(JSON.parse(init.body))) });
}

export function openAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set. Add it to the root .env (the env file in ~/dev/env/cn-return-bot).");
  return new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES, fetch: fetchWithExamplesBreakpoint });
}

/** One request as the run log stores it. */
export interface RequestLog extends RequestUsage {
  agent: string;
  /** The request's number within its agent, from 1. */
  turn: number;
  startedAt: string;
  durationMs: number;
  /** The tier OpenAI says it served the request on. */
  tier: ServiceTier;
  reasoningTokens: number;
  costUsd: number;
}

/** One agent's conversation as the model last saw it, and its log. */
export class Transcript {
  lastInput: AgentInputItem[] = [];
  lastOutput: AgentOutputItem[] = [];
  /** Input tokens of the agent's previous request, which the next request
   *  should read from the cache. */
  private previousInputTokens = 0;
  private turn = 0;

  constructor(
    readonly agent: string,
    private readonly log: RequestLog[],
  ) {}

  record(request: ModelRequest, response: ModelResponse, startedAt: number) {
    this.turn += 1;
    this.lastInput = typeof request.input === "string" ? [{ role: "user", content: request.input }] : request.input;
    this.lastOutput = response.output;
    const entry = requestLog(this.agent, this.turn, response, startedAt);
    warnAboutRequest(entry, this.previousInputTokens);
    this.previousInputTokens = entry.inputTokens;
    this.log.push(entry);
  }
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens_details?: { ttl_30m_tokens?: number; ttl_12h_tokens?: number } };
  output_tokens_details?: { reasoning_tokens?: number };
}

/** A web search the model ran, as opposed to opening a page or searching in
 *  one. Only searches have a call fee. */
function isWebSearch(item: AgentOutputItem): boolean {
  if (item.type !== "hosted_tool_call" || item.name !== "web_search_call") return false;
  const action = (item.providerData as { action?: { type?: string } } | undefined)?.action;
  return action?.type === undefined || action.type === "search";
}

function requestLog(agent: string, turn: number, response: ModelResponse, startedAt: number): RequestLog {
  const raw = (response.providerData ?? {}) as { usage?: RawUsage; service_tier?: string };
  const usage = raw.usage ?? {};
  const writes = usage.input_tokens_details?.cache_write_tokens_details;
  const tier: ServiceTier = raw.service_tier === "flex" ? "flex" : "default";
  const tokens: RequestUsage = {
    inputTokens: usage.input_tokens ?? 0,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    write30mTokens: writes?.ttl_30m_tokens ?? 0,
    write12hTokens: writes?.ttl_12h_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    webSearches: response.output.filter(isWebSearch).length,
  };
  return {
    agent,
    turn,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    tier,
    ...tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    costUsd: requestCostUsd(tokens, tier),
  };
}

/** Two warnings. A request above 272K input tokens is billed at the
 *  long-context rate as a whole. And from its second turn on, an agent's
 *  request should read at least everything its previous request sent from the
 *  cache. When it reads less, caching broke somewhere. */
function warnAboutRequest(entry: RequestLog, previousInputTokens: number) {
  const name = `${entry.agent}, turn ${entry.turn}`;
  if (entry.inputTokens > LONG_CONTEXT_INPUT_TOKENS) {
    console.warn(`[gpt-notes] ${name}: ${entry.inputTokens} input tokens, more than ${LONG_CONTEXT_INPUT_TOKENS}. The whole request is billed at the long-context rate.`);
  }
  if (entry.turn > 1 && entry.cachedTokens < previousInputTokens) {
    console.warn(`[gpt-notes] ${name}: read only ${entry.cachedTokens} tokens from the cache, but the previous turn sent ${previousInputTokens}. The cache missed.`);
  }
}

/** The SDK's model for OpenAI's Responses API, with every answer recorded in
 *  the agent's transcript. The harness never streams. */
export class TrackedModel implements Model {
  private readonly inner: OpenAIResponsesModel;

  constructor(
    client: OpenAI,
    private readonly transcript: Transcript,
  ) {
    this.inner = new OpenAIResponsesModel(client, MODEL);
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    const response = await this.inner.getResponse(request);
    this.transcript.record(request, response, startedAt);
    return response;
  }

  getStreamedResponse(): never {
    throw new Error("The GPT harness does not stream");
  }
}
