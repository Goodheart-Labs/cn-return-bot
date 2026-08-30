/**
 * Free-key routing for any Gemini call that needs no tools and goes through
 * `trackedLlmCreate`. That function is the single place where we call OpenRouter.
 *
 * The simple-bot and prefilter text steps call OpenRouter, which has no free
 * tier. The same gemini-3-flash model is reachable through Google's native API
 * with a free AI Studio key. This adapter translates the OpenAI-style request
 * into a free-only native call, and translates the native result back into the
 * OpenAI response shape. Callers therefore need no changes. When the free key is
 * out of quota, or the native call fails for any other reason, the adapter
 * returns null and the caller falls through to OpenRouter. So this can only save
 * money and can never break a call.
 *
 * Behaving exactly like OpenRouter is the design constraint. The model is the
 * same, so only the request translation can differ. The JSON schema is converted
 * faithfully and carries an explicit `propertyOrdering`, which keeps the reasoning
 * fields ahead of the verdict fields. `reasoning_effort` maps one to one onto
 * `thinkingLevel`. `temperature` is passed through unchanged.
 *
 * The adapter gives up and lets the call go to OpenRouter in five cases. The model
 * is not a Gemini model. The free key is missing. The GEMINI_FREE_ROUTING_DISABLED
 * kill switch is set. The request uses tool calling. A message carries content
 * that is not plain text, which happens for multimodal requests because those go
 * through media analysis directly.
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

/** Maps a lowercase JSON Schema type name onto Gemini's uppercase type name. */
const TYPE_MAP: Record<string, string> = {
  object: "OBJECT",
  array: "ARRAY",
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  null: "NULL",
};

/** Converts one JSON Schema node into a Gemini responseSchema node. It recurses
 *  into properties and items. It keeps descriptions, enums and required lists.
 *  It emits propertyOrdering so the model fills the fields in the declared order,
 *  which is how a reasoning field stays ahead of a verdict field. Keys only OpenAI
 *  understands are dropped, namely additionalProperties, strict, $schema and
 *  title. */
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

/** Splits the OpenAI messages into one systemInstruction and a list of user and
 *  model turns. It returns null when a message has content that is not a string,
 *  or a role we cannot map. */
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
      return null; // A tool, function or unknown role has to go to OpenRouter.
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
  if (p.tools || p.tool_choice || p.functions) return false; // Tool calling stays on OpenRouter.
  if (!Array.isArray(p.messages)) return false;
  return true;
}

/** Builds the native params from an OpenAI-style request. Returns null when the
 *  request cannot be translated. */
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
 * Tries to serve an OpenAI-style chat request through the free native Gemini key.
 * On success it returns the response in the OpenAI shape together with the cost.
 * It returns null when the request cannot be routed this way, and also when the
 * free key failed. The caller then falls back to OpenRouter.
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
