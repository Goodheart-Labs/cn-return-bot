/**
 * Free-key routing for any non-tooling Gemini call that goes through
 * `trackedLlmCreate` (the OpenRouter chokepoint).
 *
 * Why: simple-bot and prefilter text steps call OpenRouter, which has no free tier.
 * The same gemini-3-flash model is reachable via Google's native API with a free
 * AI Studio key. This adapter translates the OpenAI-style request into a
 * free-only native call and the native result back into the OpenAI response
 * shape, so callers are unchanged. On free-key quota (or any native failure) it
 * returns null and the caller falls through to OpenRouter — so this only ever
 * saves money, never breaks a call.
 *
 * Parity with OpenRouter is the design constraint (same model, so only request
 * translation can differ): the JSON schema is converted faithfully with explicit
 * `propertyOrdering` (preserves reasoning-before-verdict), `reasoning_effort`
 * maps 1:1 to `thinkingLevel`, and `temperature` passes through.
 *
 * Scope guards — bails (→ OpenRouter) on: non-gemini models, missing free key,
 * the GEMINI_FREE_ROUTING_DISABLED kill-switch, tool-calling requests, and
 * non-text message content (multimodal goes through media analysis directly).
 */

import { llm } from "./llm";
import { type TokenCost } from "../cost-tracking/pricing";
import {
  geminiFreeKey,
  geminiNativeGenerateFree,
  isQuotaError,
  type GeminiTurn,
  type GeminiThinkingLevel,
} from "./gemini";

type ChatParams = Parameters<typeof llm.create>[0];

const GEMINI_MODEL_PREFIX = "google/gemini";

const THINKING_LEVEL: Record<string, GeminiThinkingLevel> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
};

function routingDisabled(): boolean {
  return !!process.env.GEMINI_FREE_ROUTING_DISABLED;
}

/** lowercase OpenAI/JSON-Schema type → uppercase Gemini Type. */
const TYPE_MAP: Record<string, string> = {
  object: "OBJECT",
  array: "ARRAY",
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  null: "NULL",
};

/** Convert an OpenAI/JSON-Schema node to a Gemini responseSchema node. Recurses
 *  into properties/items, preserves descriptions/enums/required, emits
 *  propertyOrdering so field order (reasoning before verdict) is guaranteed, and
 *  drops OpenAI-only keys (additionalProperties, strict, $schema, title). */
function toGeminiSchema(node: any): any {
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  if (node.type) out.type = TYPE_MAP[node.type] ?? String(node.type).toUpperCase();
  if (node.description) out.description = node.description;
  if (node.enum) out.enum = node.enum;
  if (node.format) out.format = node.format;
  if (node.nullable !== undefined) out.nullable = node.nullable;
  if (node.items) out.items = toGeminiSchema(node.items);
  if (node.properties && typeof node.properties === "object") {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      properties[key] = toGeminiSchema(value);
    }
    out.properties = properties;
    out.propertyOrdering = Object.keys(node.properties);
  }
  if (node.required) out.required = node.required;
  return out;
}

/** Split OpenAI messages into a systemInstruction + user/model turns. Returns
 *  null when any message has non-string content or an unsupported role. */
function splitMessages(messages: any[]): { systemInstruction?: string; turns: GeminiTurn[] } | null {
  const systemParts: string[] = [];
  const turns: GeminiTurn[] = [];
  for (const message of messages) {
    const { role, content } = message ?? {};
    if (typeof content !== "string") return null;
    if (role === "system" || role === "developer") {
      systemParts.push(content);
    } else if (role === "user") {
      turns.push({ role: "user", text: content });
    } else if (role === "assistant") {
      turns.push({ role: "model", text: content });
    } else {
      return null; // tool / function / unknown roles → OpenRouter
    }
  }
  return {
    systemInstruction: systemParts.length ? systemParts.join("\n\n") : undefined,
    turns,
  };
}

function isGeminiModel(model: unknown): model is string {
  return typeof model === "string" && model.startsWith(GEMINI_MODEL_PREFIX);
}

/** True when this request is a candidate for free-key native routing. */
function isRoutable(params: ChatParams): boolean {
  const p = params as any;
  if (routingDisabled()) return false;
  if (!isGeminiModel(p.model)) return false;
  if (!geminiFreeKey()) return false;
  if (p.tools || p.tool_choice || p.functions) return false; // tool-calling stays on OpenRouter
  if (!Array.isArray(p.messages)) return false;
  return true;
}

/** Build the native params from an OpenAI-style request, or null if unsupported. */
function toNativeParams(params: ChatParams) {
  const p = params as any;
  const split = splitMessages(p.messages);
  if (!split) return null;

  const native: Parameters<typeof geminiNativeGenerateFree>[0] = {
    model: p.model.replace(/^google\//, ""),
    systemInstruction: split.systemInstruction,
    userTurns: split.turns,
  };
  if (typeof p.temperature === "number") native.temperature = p.temperature;
  if (typeof p.reasoning_effort === "string" && THINKING_LEVEL[p.reasoning_effort]) {
    native.thinkingLevel = THINKING_LEVEL[p.reasoning_effort];
  }

  const rf = p.response_format;
  if (rf?.type === "json_schema" && rf.json_schema?.schema) {
    native.responseSchema = toGeminiSchema(rf.json_schema.schema);
  } else if (rf?.type === "json_object") {
    native.jsonOutput = true;
  }
  return native;
}

/**
 * Try to serve an OpenAI-style chat request via the free native Gemini key.
 * Returns the OpenAI-shaped response + cost on success, or null when the request
 * isn't routable or the free key failed (caller falls back to OpenRouter).
 */
export async function tryGeminiFreeChat(
  params: ChatParams,
): Promise<{ response: any; cost: TokenCost } | null> {
  if (!isRoutable(params)) return null;
  const native = toNativeParams(params);
  if (!native) return null;

  try {
    const result = await geminiNativeGenerateFree(native);
    const response = {
      choices: [{ message: { role: "assistant", content: result.text } }],
      usage: {
        prompt_tokens: result.cost.input_tokens,
        completion_tokens: result.cost.output_tokens,
        cost: result.cost.cost,
      },
    };
    return { response, cost: result.cost };
  } catch (err: any) {
    if (!isQuotaError(err)) {
      console.warn(
        `[gemini-route] free-key call failed (model: ${(params as any).model}); falling back to OpenRouter: ${err?.message?.slice(0, 200)}`,
      );
    }
    return null;
  }
}
