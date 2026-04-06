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
} from "../agent/agentPricing";

// --- Types ---

export interface AgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  tools: any[];
  terminalTools: string[];
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
  searchOutputs: string[];
}

const MAX_ITERATIONS = 25;
const MULTI_AGENT_MODEL = "anthropic/claude-sonnet-4.6";

export { MULTI_AGENT_MODEL };

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
    case "no_correction_needed":
      return { output: { acknowledged: true }, isTerminal: true };
    default:
      return { output: { error: `Unknown tool: ${name}` }, isTerminal: false };
  }
}

// --- Agent turn loop ---

export async function runAgentTurn(state: AgentState): Promise<TurnResult> {
  const log = getTweetLog();
  state.turnCount++;
  const turn = state.turnCount;
  const agentName = state.def.name;
  const prefix = `multiAgent.${agentName}.turn.${turn}`;

  // Log the user message that triggered this turn
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.role === "user") {
    log?.set(`${prefix}.userMessage`, lastMsg.content);
  }

  const turnCost = emptyTokenCost();
  const searchOutputs: string[] = [];
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await llm.create({
      model: MULTI_AGENT_MODEL,
      messages: state.messages,
      tools: state.def.tools,
    });

    const message = response.choices?.[0]?.message;
    if (!message) {
      console.error(`[${agentName}] No message in response at iteration ${iteration}`);
      break;
    }

    const iterCost = extractOpenRouterCost(response);
    addTokenCost(turnCost, iterCost);

    // Log content
    if (message.content) {
      log?.set(`${prefix}.messages.${iteration}.content`, message.content);
    }

    // Log reasoning if present
    const reasoning = (message as any).reasoning;
    if (reasoning) {
      log?.set(`${prefix}.messages.${iteration}.reasoning`, reasoning);
    }

    // Handle native web_search annotations
    const annotations = (message as any).annotations as any[] | undefined;
    if (annotations?.length) {
      log?.set(`${prefix}.messages.${iteration}.annotations`, annotations);
      const urls = annotations
        .filter((a: any) => a.type === "url_citation")
        .map((a: any) => `${a.url_citation?.title}: ${a.url_citation?.url}`)
        .join("\n");
      if (urls) searchOutputs.push(`--- web_search ---\n${urls}`);
    }

    // No tool calls
    if (!message.tool_calls?.length) {
      if (annotations?.length) {
        // Model used web_search server-side, continue loop
        state.messages.push(message);
        continue;
      }
      // No tool calls and no annotations — treat as implicit no_correction
      return {
        terminalTool: "no_correction_needed",
        args: { reason: typeof message.content === "string" ? message.content : "No tool calls made" },
        cost: turnCost,
        iterations: iteration,
        searchOutputs,
      };
    }

    // Add assistant message to conversation
    state.messages.push(message);

    // Execute tool calls
    for (const toolCall of message.tool_calls) {
      let name: string;
      let args: Record<string, any> = {};

      if (toolCall.type === "function") {
        name = toolCall.function.name;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = { raw: toolCall.function.arguments };
        }
      } else {
        const custom = (toolCall as any).custom;
        name = custom?.name ?? (toolCall as any).type ?? "unknown_builtin";
        try {
          args = custom?.input ? JSON.parse(custom.input) : {};
        } catch {
          args = { raw: custom?.input };
        }
      }

      const toolStartMs = Date.now();
      const result = await executeToolCall(name, args);
      const toolDurationMs = Date.now() - toolStartMs;

      // Log tool call
      log?.set(`${prefix}.messages.${iteration}.${name}`, {
        args,
        result: result.output,
        durationMs: toolDurationMs,
      });

      // Track tool cost
      if (result.cost) {
        addTokenCost(turnCost, result.cost);
      }

      // Add tool result to conversation
      state.messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content:
          typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.output),
      });

      // Track search outputs
      if (name === "grok_search" || name === "perplexity_search") {
        const text = result.output?.results ?? JSON.stringify(result.output);
        searchOutputs.push(`--- ${name} ---\n${text}`);
      }

      // Check for terminal tool
      if (state.def.terminalTools.includes(name)) {
        addTokenCost(state.cost, turnCost);
        log?.set(`${prefix}.iterations`, iteration);
        log?.set(`${prefix}.cost`, turnCost);

        return {
          terminalTool: name,
          args,
          cost: turnCost,
          iterations: iteration,
          searchOutputs,
        };
      }
    }
  }

  // Loop exhausted
  addTokenCost(state.cost, turnCost);
  log?.set(`${prefix}.iterations`, iteration);
  log?.set(`${prefix}.cost`, turnCost);

  return {
    terminalTool: "error",
    args: { reason: `Loop exhausted after ${MAX_ITERATIONS} iterations` },
    cost: turnCost,
    iterations: iteration,
    searchOutputs,
  };
}
