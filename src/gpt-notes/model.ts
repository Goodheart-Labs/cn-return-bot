/* The connection to GPT-6.1 Terra, and the wrapper that records every request.
 *
 * Requests go to a Responses API: OpenAI's own, or OpenRouter's, which passes
 * them on to OpenAI (GOO-688). The wrapper retries failed requests and logs
 * what each request cost. */

import type { AgentOutputItem, Model, ModelRequest, ModelResponse } from "@openai/agents";
import { ModelBehaviorError, OpenAIResponsesModel } from "@openai/agents";
import OpenAI from "openai";
import { LONG_CONTEXT_INPUT_TOKENS, requestCostUsd, type RequestUsage, type ServiceTier } from "./pricing";

export type Provider = "openai" | "openrouter";

/** OpenRouter forwards the request to OpenAI and bills the same list prices.
 *  It passes on the cache breakpoints, the cache key and the tier. */
const CONNECTIONS: Record<Provider, { baseURL?: string; keyName: string; model: string }> = {
  openai: { keyName: "OPENAI_API_KEY", model: "gpt-6.1-terra" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", keyName: "OPENROUTER_API_KEY", model: "openai/gpt-6.1-terra" },
};

/** OpenAI's advice for flex: a flex request may wait a long time for a free
 *  machine, so the client waits up to 15 minutes for an answer. */
const REQUEST_TIMEOUT_MS = 15 * 60_000;
/** A failed request is retried this often, with growing waits, and then the
 *  run fails. Every retry runs on the standard tier: OpenAI turns flex
 *  requests away when it is busy, sometimes for a whole day, and a retry on
 *  flex would likely be turned away again. The harness does its own retries,
 *  so the OpenAI client makes none. */
const MAX_RETRIES = 6;
const FIRST_RETRY_WAIT_MS = 2_000;
const MAX_RETRY_WAIT_MS = 60_000;
const RETRY_TIER: ServiceTier = "default";

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

export function openAIClient(provider: Provider): OpenAI {
  const { baseURL, keyName } = CONNECTIONS[provider];
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`${keyName} is not set. Add it to the root .env (the env file in ~/dev/env/cn-return-bot).`);
  return new OpenAI({ apiKey, baseURL, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0, fetch: fetchWithExamplesBreakpoint });
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
  /** All input tokens written to the cache. OpenAI also splits them by
   *  lifetime above; OpenRouter reports only this total. */
  cacheWriteTokens: number;
  costUsd: number;
}

/** The requests of one conversation, numbered from 1, in the run's log. */
class Transcript {
  /** What the conversation's previous request read from the cache and wrote
   *  to it. The next request should read at least all of that. */
  private previousCachedPrefix = 0;
  private turn = 0;

  constructor(
    readonly agent: string,
    private readonly log: RequestLog[],
  ) {}

  record(response: ModelResponse, startedAt: number) {
    this.turn += 1;
    const entry = requestLog(this.agent, this.turn, response, startedAt);
    warnAboutRequest(entry, this.previousCachedPrefix);
    this.previousCachedPrefix = entry.cachedTokens + entry.cacheWriteTokens;
    this.log.push(entry);
  }
}

/** Where a model writes what its requests did. */
export interface RunLog {
  requests: RequestLog[];
  /** Requests that still failed after every retry. They end their agent. A
   *  subagent's failure only reaches its parent as "An error occurred while
   *  running the tool", so this list is where it shows. */
  failedRequests: string[];
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number; cache_write_tokens_details?: { ttl_30m_tokens?: number; ttl_12h_tokens?: number } };
  output_tokens_details?: { reasoning_tokens?: number };
  /** What OpenRouter billed for the request, web searches included. */
  cost?: number;
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
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
    costUsd: usage.cost ?? requestCostUsd(tokens, tier),
  };
}

/** Two warnings. A request above 272K input tokens is billed at the
 *  long-context rate as a whole. And from its second turn on, an agent's
 *  request should read from the cache at least everything its previous
 *  request read or wrote there. When it reads less, caching broke somewhere.
 *  The previous request's input count is no measure, because it includes the
 *  search results OpenAI added inside that request, which never come back. */
function warnAboutRequest(entry: RequestLog, previousCachedPrefix: number) {
  const name = `${entry.agent}, turn ${entry.turn}`;
  if (entry.inputTokens > LONG_CONTEXT_INPUT_TOKENS) {
    console.warn(`[gpt-notes] ${name}: ${entry.inputTokens} input tokens, more than ${LONG_CONTEXT_INPUT_TOKENS}. The whole request is billed at the long-context rate.`);
  }
  if (entry.turn > 1 && entry.cachedTokens < previousCachedPrefix) {
    console.warn(`[gpt-notes] ${name}: read only ${entry.cachedTokens} tokens from the cache, but the previous turn had ${previousCachedPrefix} there. The cache missed.`);
  }
}

function onTier(request: ModelRequest, tier: ServiceTier): ModelRequest {
  const { modelSettings } = request;
  return { ...request, modelSettings: { ...modelSettings, providerData: { ...modelSettings.providerData, service_tier: tier } } };
}

const RETRYABLE_STATUSES = [408, 409, 429];
const MIN_SERVER_ERROR_STATUS = 500;

/** Busy answers, server errors and lost connections are worth a retry. A
 *  response that ended as failed is too: that is how OpenRouter passes on
 *  OpenAI's "Flex processing is temporarily unavailable". An empty account is
 *  not, and neither is a request OpenAI refused as invalid. */
function isRetryable(err: unknown): boolean {
  if (err instanceof ModelBehaviorError) return err.message.includes("response.failed");
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (!(err instanceof OpenAI.APIError) || err.status === undefined) return false;
  if (err.code === "insufficient_quota" || err.message.includes("no credits")) return false;
  return RETRYABLE_STATUSES.includes(err.status) || err.status >= MIN_SERVER_ERROR_STATUS;
}

/** The SDK's model for OpenAI's Responses API, with every answer recorded in
 *  the agent's transcript and failed requests retried on the standard tier.
 *  The harness never streams. */
export class TrackedModel implements Model {
  private readonly inner: OpenAIResponsesModel;
  private readonly transcripts = new Map<string, Transcript>();

  constructor(
    client: OpenAI,
    provider: Provider,
    private readonly name: string,
    private readonly runLog: RunLog,
  ) {
    this.inner = new OpenAIResponsesModel(client, CONNECTIONS[provider].model);
  }

  /** One model serves every subagent of a run, and several subagents run at
   *  the same time. A conversation is told apart by its first message after
   *  the examples, which holds the subagent's task. */
  private transcriptFor(request: ModelRequest): Transcript {
    const key = JSON.stringify(Array.isArray(request.input) ? request.input[1] : request.input);
    let transcript = this.transcripts.get(key);
    if (!transcript) {
      transcript = new Transcript(`${this.name} ${this.transcripts.size + 1}`, this.runLog.requests);
      this.transcripts.set(key, transcript);
    }
    return transcript;
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const transcript = this.transcriptFor(request);
    for (let retry = 0; ; retry++) {
      const startedAt = Date.now();
      try {
        const response = await this.inner.getResponse(retry === 0 ? request : onTier(request, RETRY_TIER));
        transcript.record(response, startedAt);
        return response;
      } catch (err) {
        const message = `${transcript.agent}: ${(err as Error).message}`;
        if (retry >= MAX_RETRIES || !isRetryable(err)) {
          this.runLog.failedRequests.push(message);
          throw err;
        }
        const waitMs = Math.min(FIRST_RETRY_WAIT_MS * 2 ** retry, MAX_RETRY_WAIT_MS);
        console.warn(`[gpt-notes] ${transcript.agent}: request failed (${(err as Error).message}). Retry ${retry + 1} of ${MAX_RETRIES} on the standard tier in ${waitMs / 1000}s.`);
        await Bun.sleep(waitMs);
      }
    }
  }

  getStreamedResponse(): never {
    throw new Error("The GPT harness does not stream");
  }
}
