/**
 * The client-side tool-calling loop. It is for models that have no built-in web
 * search, such as Muse, Kimi, GLM and DeepSeek. The model asks for a tool call,
 * we run the tool and append its result, and the model continues until it
 * answers in plain content. The simple bot's search step and the everything
 * pipeline's claim rater both drive their research through this one loop.
 *
 * Everything that depends on where the loop runs comes in as a callback. The
 * search step runs the tools through the bot config and logs into the tweet
 * log. The rater runs in the extraction service, where neither exists.
 */

import { llm } from "../llm/llm";
import { addTokenCost, emptyTokenCost, extractOpenRouterCost, type TokenCost } from "../cost-tracking/pricing";
import type { ToolCallCost } from "../cost-tracking/costTracker";
import { executeToolCall, type ToolResult } from "./tools";

export interface ToolLoopParams {
  model: string;
  /** The conversation so far. The loop appends the model's tool-call turns and
   *  the tool results to it, so the caller can continue the conversation
   *  afterwards, for example to ask again for valid JSON. */
  messages: any[];
  tools: any[];
  maxTurns: number;
  /** Attached on every turn that does not force a tool call. A forced turn
   *  cannot answer with content, so the format would have no effect there, and
   *  some providers reject the pair outright. */
  responseFormat?: object;
  /** Whether turn 1 obliges the model to call a tool. Defaults to true. Some
   *  models otherwise answer straight from the schema without searching. */
  forceFirstTurn?: boolean;
  /** Runs one tool call. Defaults to the agent flow's executeToolCall, which
   *  reads the bot config to pick the search backend. */
  executeTool?: (name: string, args: Record<string, any>) => Promise<ToolResult>;
  /** Receives every log entry the loop makes, keyed relative to the step, such
   *  as `turn.2.google_search`. Absent means nothing is logged. */
  log?: (key: string, value: unknown) => void;
  /** Extra request parameters, such as reasoning_effort. */
  llmParams?: Record<string, unknown>;
}

export interface ToolLoopResult {
  /** The model's final answer. */
  content: string;
  cost: TokenCost;
  toolCosts: ToolCallCost[];
  /** Every tool call the model made, in order. */
  toolCalls: { name: string; args: Record<string, any> }[];
  /** True when the model was still calling tools after `maxTurns` and one last
   *  call without tools produced the answer. */
  forcedSynthesis: boolean;
}

/** The provider refused the value we gave for tool_choice, rather than failing
 *  for some passing reason. OpenRouter wraps an upstream failure as a 400 and
 *  puts the provider's own error body in metadata.raw, so that string is where
 *  the offending parameter name appears. */
export function rejectsForcedToolCall(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status !== 400) return false;
  return String(err?.error?.metadata?.raw ?? "").includes("tool_choice");
}

/** Runs one turn.
 *
 *  Some providers accept only "auto" for tool_choice and reject "required"
 *  outright. Meta is one, which is what stopped the Muse arm from running at
 *  all. That is a fixed property of the provider rather than a passing failure,
 *  so the only way to get the turn done is to ask again without forcing the
 *  tool call, which also means attaching the response format the forced call
 *  left off.
 *
 *  We lose the guarantee that the model searches on this turn, which is the
 *  thing forcing was added to provide. Muse called google_search on all five
 *  samples we tried, so in practice it still searches. A provider that accepts
 *  "required" never reaches the fallback, so no other arm changes behaviour. */
async function callTurn(params: ToolLoopParams, forceToolCall: boolean): Promise<any> {
  const responseFormat = params.responseFormat ? { response_format: params.responseFormat } : {};
  const request = {
    model: params.model,
    messages: params.messages,
    tools: params.tools,
    tool_choice: forceToolCall ? "required" : "auto",
    ...(forceToolCall ? {} : responseFormat),
    ...params.llmParams,
  };
  try {
    return await llm.create(request as any);
  } catch (err) {
    if (!forceToolCall || !rejectsForcedToolCall(err)) throw err;
    params.log?.("forcedToolCallUnsupported", { model: params.model });
    return await llm.create({ ...request, tool_choice: "auto", ...responseFormat } as any);
  }
}

export async function runToolLoop(params: ToolLoopParams): Promise<ToolLoopResult> {
  const executeTool = params.executeTool ?? executeToolCall;
  const cost = emptyTokenCost();
  const toolCosts: ToolCallCost[] = [];
  const toolCalls: ToolLoopResult["toolCalls"] = [];

  for (let turn = 1; turn <= params.maxTurns; turn++) {
    const forceToolCall = turn === 1 && (params.forceFirstTurn ?? true);
    const response = await callTurn(params, forceToolCall);
    addTokenCost(cost, extractOpenRouterCost(response));

    const message = response.choices?.[0]?.message;
    if (!message) throw new Error(`tool loop: empty response on turn ${turn}`);

    if (!message.tool_calls?.length) {
      return { content: message.content ?? "", cost, toolCosts, toolCalls, forcedSynthesis: false };
    }

    params.messages.push(message);
    for (const [i, tc] of message.tool_calls.entries()) {
      const name = tc.function?.name ?? "unknown";
      const args = JSON.parse(tc.function?.arguments ?? "{}");
      const startedAt = Date.now();
      const result = await executeTool(name, args);
      const logKey = i === 0 ? name : `${name}_${i}`;
      params.log?.(`turn.${turn}.${logKey}`, { args, result: result.output, durationMs: Date.now() - startedAt });
      if (result.cost) toolCosts.push({ name: logKey, ...result.cost });
      toolCalls.push({ name, args });
      params.messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
      });
    }
  }

  // The loop ran out of turns. Some models, deepseek-v3.2-exp for one, keep
  // searching past the turn limit and never produce a final answer on their
  // own. One more call with no tools attached forces them to write one. Every
  // tool result they gathered is already in the message list.
  params.log?.("forced_synthesis", true);
  params.messages.push({ role: "user", content: "Stop searching. Return your final answer as JSON now." });
  const response = await llm.create({
    model: params.model,
    messages: params.messages,
    ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
    ...params.llmParams,
  } as any);
  addTokenCost(cost, extractOpenRouterCost(response));
  return { content: response.choices?.[0]?.message?.content ?? "", cost, toolCosts, toolCalls, forcedSynthesis: true };
}
