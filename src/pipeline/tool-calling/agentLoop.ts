/**
 * Agent Loop
 *
 * General-purpose tool-calling loop. Runs an LLM with tools until a terminal
 * tool is called or iterations exhaust. Costs tracked via CostTracker ALS.
 */

import { llm } from "../llm/llm";
import { getTweetLog } from "../utils/tweetLog";
import { executeToolCall } from "./tools";
import { extractOpenRouterCost } from "../utils/pricing";
import { trackLlmCall, type LlmCallCost } from "../utils/costTracker";

// --- Types ---

export interface AgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  tools: any[];
  terminalTools: string[];
  model: string;
}

export interface AgentState {
  def: AgentDef;
  messages: any[];
  turnCount: number;
}

export interface TurnResult {
  terminalTool: string;
  args: Record<string, any>;
  iterations: number;
  searchOutputs: string[];
}

const DEFAULT_MAX_ITERATIONS = 25;

// --- Agent initialization ---

export function initAgentState(def: AgentDef): AgentState {
  return {
    def,
    messages: [{ role: "system", content: def.systemPrompt }],
    turnCount: 0,
  };
}

export function addUserMessage(state: AgentState, message: string): void {
  state.messages.push({ role: "user", content: message });
}

// --- send_message tool builder ---

export function buildSendMessageTool(targets: string[]): any {
  return {
    type: "function" as const,
    function: {
      name: "send_message",
      description: "Send a message to another agent or to output. This ends your turn.",
      parameters: {
        type: "object" as const,
        properties: {
          to: { type: "string" as const, enum: targets, description: "Who to send the message to." },
          message: { type: "string" as const, description: "Your message." },
        },
        required: ["to", "message"],
      },
    },
  };
}

// --- Tool call parsing ---

function parseToolCall(toolCall: any): { name: string; args: Record<string, any> } {
  if (toolCall.type === "function") {
    try {
      return { name: toolCall.function.name, args: JSON.parse(toolCall.function.arguments) };
    } catch {
      return { name: toolCall.function.name, args: { raw: toolCall.function.arguments } };
    }
  }
  const custom = (toolCall as any).custom;
  const name = custom?.name ?? (toolCall as any).type ?? "unknown_builtin";
  try {
    return { name, args: custom?.input ? JSON.parse(custom.input) : {} };
  } catch {
    return { name, args: { raw: custom?.input } };
  }
}

// --- Response logging ---

function logResponse(
  message: any,
  prefix: string,
  iteration: number,
  searchOutputs: string[],
): void {
  const log = getTweetLog();

  if (message.content) {
    log?.set(`${prefix}.${iteration}.content`, message.content);
  }

  const reasoning = (message as any).reasoning;
  if (reasoning) {
    log?.set(`${prefix}.${iteration}.reasoning`, reasoning);
  }

  const annotations = (message as any).annotations as any[] | undefined;
  if (annotations?.length) {
    log?.set(`${prefix}.${iteration}.annotations`, annotations);
    const urls = annotations
      .filter((a: any) => a.type === "url_citation")
      .map((a: any) => `${a.url_citation?.title}: ${a.url_citation?.url}`)
      .join("\n");
    if (urls) searchOutputs.push(`--- web_search ---\n${urls}`);
  }

}

// --- Process a single tool call ---

async function processToolCall(
  toolCall: any,
  toolIndex: number,
  state: AgentState,
  prefix: string,
  iteration: number,
  costEntry: LlmCallCost,
  searchOutputs: string[],
): Promise<TurnResult | null> {
  const log = getTweetLog();
  const { name, args } = parseToolCall(toolCall);

  const toolStartMs = Date.now();
  const result = await executeToolCall(name, args);
  const toolDurationMs = Date.now() - toolStartMs;

  const logKey = toolIndex === 0 ? name : `${name}_${toolIndex}`;
  log?.set(`${prefix}.${iteration}.${logKey}`, {
    args,
    result: result.output,
    durationMs: toolDurationMs,
  });

  if (result.cost) {
    costEntry.tools.push({ name: logKey, ...result.cost });
  }

  state.messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
  });

  if (name === "grok_search" || name === "perplexity_search") {
    const text = result.output?.results ?? JSON.stringify(result.output);
    searchOutputs.push(`--- ${name} ---\n${text}`);
  }

  if (state.def.terminalTools.includes(name)) {
    return { terminalTool: name, args, iterations: iteration, searchOutputs };
  }

  return null;
}

// --- Agent turn loop ---

export async function runAgentTurn(
  state: AgentState,
  logPrefix: string,
  maxIterations = DEFAULT_MAX_ITERATIONS,
): Promise<TurnResult> {
  state.turnCount++;
  const agentName = state.def.name;
  const log = getTweetLog();

  if (state.turnCount === 1) {
    log?.set(`${logPrefix}.0.systemPrompt`, state.def.systemPrompt);
  }
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.role === "user") {
    log?.set(`${logPrefix}.0.userMessage`, lastMsg.content);
  }

  const searchOutputs: string[] = [];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const costEntry: LlmCallCost = {
      name: `${logPrefix}.${iteration}`,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      tools: [],
    };

    const response = await llm.create({
      model: state.def.model,
      messages: state.messages,
      tools: state.def.tools,
      // @ts-expect-error OpenRouter extended thinking
      reasoning: { effort: "medium" },
    });

    const message = response.choices?.[0]?.message;
    if (!message) {
      console.error(`[${agentName}] No message in response at iteration ${iteration}`);
      trackLlmCall(costEntry);
      break;
    }

    const llmCost = extractOpenRouterCost(response);
    costEntry.input_tokens = llmCost.input_tokens;
    costEntry.output_tokens = llmCost.output_tokens;
    costEntry.cost = llmCost.cost;

    logResponse(message, logPrefix, iteration, searchOutputs);

    const webSearchRequests = (response as any).usage?.server_tool_use?.web_search_requests ?? 0;
    if (webSearchRequests > 0) {
      log?.set(`${logPrefix}.${iteration}.web_search_requests`, webSearchRequests);
    }

    if (!message.tool_calls?.length) {
      trackLlmCall(costEntry);

      const hasAnnotations = Array.isArray((message as any).annotations) && (message as any).annotations.length > 0;
      if (hasAnnotations) {
        state.messages.push(message);
        continue;
      }

      log?.set(`${logPrefix}.iterations`, iteration);
      return {
        terminalTool: "no_correction_needed",
        args: { reason: typeof message.content === "string" ? message.content : "No tool calls made" },
        iterations: iteration,
        searchOutputs,
      };
    }

    state.messages.push(message);

    for (let ti = 0; ti < message.tool_calls.length; ti++) {
      const terminal = await processToolCall(message.tool_calls[ti], ti, state, logPrefix, iteration, costEntry, searchOutputs);
      if (terminal) {
        trackLlmCall(costEntry);
        log?.set(`${logPrefix}.iterations`, iteration);
        return terminal;
      }
    }

    trackLlmCall(costEntry);
  }

  log?.set(`${logPrefix}.iterations`, iteration);
  return {
    terminalTool: "error",
    args: { reason: `Loop exhausted after ${maxIterations} iterations` },
    iterations: iteration,
    searchOutputs,
  };
}
