/**
 * Agent Framework
 *
 * General-purpose multi-agent abstraction. Each agent has a name, description,
 * system prompt, and tools. The framework runs tool-calling loops and tracks
 * costs. Agents communicate via send_message (routed by the orchestrator).
 */

import { llm } from "../llm/llm";
import { getTweetLog } from "../utils/tweetLog";
import {
  type ToolResult,
  handleGrokSearch,
  handlePerplexitySearch,
  handleWebFetch,
  handleProposeNotes,
} from "../agent/agentTools";
import {
  extractOpenRouterCost,
  emptyTokenCost,
  addTokenCost,
  type TokenCost,
  type IterationCost,
} from "../agent/agentPricing";

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
  cost: TokenCost;
}

export interface TurnResult {
  terminalTool: string;
  args: Record<string, any>;
  cost: TokenCost;
  iterations: number;
  iterationCosts: Record<number, IterationCost>;
  searchOutputs: string[];
}

const MAX_ITERATIONS = 25;

// --- Agent initialization ---

export function initAgentState(def: AgentDef): AgentState {
  return {
    def,
    messages: [{ role: "system", content: def.systemPrompt }],
    turnCount: 0,
    cost: emptyTokenCost(),
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
      description:
        "Send a message to another agent or to output. This ends your turn.",
      parameters: {
        type: "object" as const,
        properties: {
          to: {
            type: "string" as const,
            enum: targets,
            description: "Who to send the message to.",
          },
          message: {
            type: "string" as const,
            description: "Your message.",
          },
        },
        required: ["to", "message"],
      },
    },
  };
}

// --- Tool execution ---

async function executeToolCall(
  name: string,
  args: Record<string, any>,
): Promise<ToolResult> {
  switch (name) {
    case "grok_search":
      return handleGrokSearch(args.query);
    case "perplexity_search":
      return handlePerplexitySearch(args.query);
    case "web_fetch":
      return handleWebFetch(args.url);
    case "propose_notes":
      return handleProposeNotes(args.notes);
    case "send_message":
      return { output: { acknowledged: true }, isTerminal: true };
    case "approve_note":
      return { output: { acknowledged: true }, isTerminal: true };
    case "no_correction_needed":
      return { output: { acknowledged: true }, isTerminal: true };
    default:
      return { output: { error: `Unknown tool: ${name}` }, isTerminal: false };
  }
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
  // Built-in tool reported as custom type
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
  response: any,
  prefix: string,
  iteration: number,
  searchOutputs: string[],
  iterCost: IterationCost,
): void {
  const log = getTweetLog();

  // Track LLM cost for this iteration
  const llmCost = extractOpenRouterCost(response);
  iterCost.input_tokens += llmCost.input_tokens;
  iterCost.output_tokens += llmCost.output_tokens;
  iterCost.cost += llmCost.cost;

  if (message.content) {
    log?.set(`${prefix}.messages.${iteration}.content`, message.content);
  }

  const reasoning = (message as any).reasoning;
  if (reasoning) {
    log?.set(`${prefix}.messages.${iteration}.reasoning`, reasoning);
  }

  const annotations = (message as any).annotations as any[] | undefined;
  if (annotations?.length) {
    log?.set(`${prefix}.messages.${iteration}.annotations`, annotations);
    const urls = annotations
      .filter((a: any) => a.type === "url_citation")
      .map((a: any) => `${a.url_citation?.title}: ${a.url_citation?.url}`)
      .join("\n");
    if (urls) searchOutputs.push(`--- web_search ---\n${urls}`);
  }
}

function hasAnnotations(message: any): boolean {
  const annotations = (message as any).annotations;
  return Array.isArray(annotations) && annotations.length > 0;
}

// --- Process a single tool call, log it, update state ---

async function processToolCall(
  toolCall: any,
  toolIndex: number,
  state: AgentState,
  prefix: string,
  iteration: number,
  iterCost: IterationCost,
  searchOutputs: string[],
): Promise<TurnResult | null> {
  const log = getTweetLog();
  const { name, args } = parseToolCall(toolCall);

  const toolStartMs = Date.now();
  const result = await executeToolCall(name, args);
  const toolDurationMs = Date.now() - toolStartMs;

  // Use toolIndex suffix to avoid overwrites when multiple calls share a name
  const logKey = toolIndex === 0 ? name : `${name}_${toolIndex}`;
  log?.set(`${prefix}.messages.${iteration}.${logKey}`, {
    args,
    result: result.output,
    durationMs: toolDurationMs,
  });

  // Track tool cost in this iteration's breakdown
  if (result.cost) {
    iterCost.tools[logKey] = result.cost;
    iterCost.cost += result.cost.cost;
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
    return { terminalTool: name, args, cost: emptyTokenCost(), iterations: iteration, iterationCosts: {}, searchOutputs };
  }

  return null;
}

// --- Finalize turn (log costs + accumulate) ---

function finalizeTurn(
  state: AgentState,
  prefix: string,
  iteration: number,
  turnCost: TokenCost,
): void {
  addTokenCost(state.cost, turnCost);
  getTweetLog()?.set(`${prefix}.iterations`, iteration);
}

// --- Agent turn loop ---

export async function runAgentTurn(state: AgentState): Promise<TurnResult> {
  state.turnCount++;
  const turn = state.turnCount;
  const agentName = state.def.name;
  const prefix = `multiAgent.${agentName}.turn.${turn}`;

  const log = getTweetLog();

  // Log messages.0: system prompt + user message that triggered this turn
  if (turn === 1) {
    log?.set(`${prefix}.messages.0.systemPrompt`, state.def.systemPrompt);
  }
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.role === "user") {
    log?.set(`${prefix}.messages.0.userMessage`, lastMsg.content);
  }

  const turnCost = emptyTokenCost();
  const iterationCosts: Record<number, IterationCost> = {};
  const searchOutputs: string[] = [];
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const iterCost: IterationCost = { input_tokens: 0, output_tokens: 0, cost: 0, tools: {} };

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
      break;
    }

    logResponse(message, response, prefix, iteration, searchOutputs, iterCost);

    // No tool calls — either web_search annotation (continue) or implicit stop
    if (!message.tool_calls?.length) {
      iterationCosts[iteration] = iterCost;
      addTokenCost(turnCost, iterCost);

      if (hasAnnotations(message)) {
        state.messages.push(message);
        continue;
      }
      finalizeTurn(state, prefix, iteration, turnCost);
      return {
        terminalTool: "no_correction_needed",
        args: { reason: typeof message.content === "string" ? message.content : "No tool calls made" },
        cost: turnCost,
        iterations: iteration,
        iterationCosts,
        searchOutputs,
      };
    }

    state.messages.push(message);

    for (let ti = 0; ti < message.tool_calls.length; ti++) {
      const toolCall = message.tool_calls[ti];
      const terminal = await processToolCall(toolCall, ti, state, prefix, iteration, iterCost, searchOutputs);
      if (terminal) {
        iterationCosts[iteration] = iterCost;
        addTokenCost(turnCost, iterCost);
        finalizeTurn(state, prefix, iteration, turnCost);
        return { ...terminal, cost: turnCost, iterationCosts };
      }
    }

    iterationCosts[iteration] = iterCost;
    addTokenCost(turnCost, iterCost);
  }

  finalizeTurn(state, prefix, iteration, turnCost);
  return {
    terminalTool: "error",
    args: { reason: `Loop exhausted after ${MAX_ITERATIONS} iterations` },
    cost: turnCost,
    iterations: iteration,
    iterationCosts,
    searchOutputs,
  };
}
