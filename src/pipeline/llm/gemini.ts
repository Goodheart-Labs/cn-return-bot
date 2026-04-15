/**
 * Gemini Native API Adapter
 *
 * Takes OpenAI-format params (messages, tools), calls the Gemini API directly,
 * and returns an OpenAI-compatible response. This enables the agent loop to work
 * with Gemini's native googleSearch tool.
 */

import { GoogleGenAI } from "@google/genai";
import { getBotConfig } from "../utils/botConfig";
import { calculateGeminiCost } from "../utils/pricing";

// --- Client ---

let _client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required but not set");
    }
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}

// --- Retry ---

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.httpStatusCode;
  if (status === 429 || status === 500 || status === 503) return true;
  if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT") return true;
  return false;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Message conversion: OpenAI -> Gemini ---

interface GeminiContent {
  role: "user" | "model";
  parts: any[];
}

/**
 * Find the function name for a tool_call_id by searching preceding assistant messages.
 */
function findFunctionName(messages: any[], toolCallId: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id === toolCallId) return tc.function.name;
      }
    }
  }
  return "unknown";
}

function convertMessages(messages: any[]): { systemInstruction?: string; contents: GeminiContent[] } {
  let systemInstruction: string | undefined;
  const contents: GeminiContent[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "system") {
      systemInstruction = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      continue;
    }

    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      contents.push({ role: "user", parts: [{ text }] });
      continue;
    }

    if (msg.role === "assistant") {
      // Use raw Gemini parts if stashed from a previous turn
      if (msg._rawGeminiParts) {
        contents.push({ role: "model", parts: msg._rawGeminiParts });
        continue;
      }

      const parts: any[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: any;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { raw: tc.function.arguments };
          }
          parts.push({ functionCall: { name: tc.function.name, args, id: tc.id } });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (msg.role === "tool") {
      const name = findFunctionName(messages, msg.tool_call_id);
      let response: any;
      try {
        response = JSON.parse(msg.content);
      } catch {
        response = { result: msg.content };
      }
      const part = { functionResponse: { name, response, id: msg.tool_call_id } };

      // Merge consecutive tool results into a single user turn
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts[0]?.functionResponse) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }
  }

  // Gemini requires strict user/model alternation. Merge consecutive same-role turns.
  const merged: GeminiContent[] = [];
  for (const c of contents) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === c.role) {
      prev.parts.push(...c.parts);
    } else {
      merged.push(c);
    }
  }

  return { systemInstruction, contents: merged };
}

// --- Tool conversion: OpenAI -> Gemini ---

function uppercaseType(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(uppercaseType);

  const result: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && typeof value === "string") {
      result[key] = value.toUpperCase();
    } else {
      result[key] = uppercaseType(value);
    }
  }
  return result;
}

function convertTools(tools: any[]): { geminiTools: any[]; toolConfig?: any } {
  const config = getBotConfig();
  const geminiTools: any[] = [];
  let hasNativeTools = false;

  if (config.web_search === "native") {
    geminiTools.push({ googleSearch: {} });
    hasNativeTools = true;
  }
  // Convert OpenAI function tools to Gemini functionDeclarations
  const functionDeclarations: any[] = [];
  for (const tool of tools) {
    if (tool.type === "function" && tool.function) {
      functionDeclarations.push({
        name: tool.function.name,
        description: tool.function.description,
        parameters: uppercaseType(tool.function.parameters),
      });
    }
  }

  if (functionDeclarations.length > 0) {
    geminiTools.push({ functionDeclarations });
  }

  // When mixing native + custom tools, enable server-side tool invocations
  const toolConfig = hasNativeTools && functionDeclarations.length > 0
    ? { includeServerSideToolInvocations: true }
    : undefined;

  return { geminiTools, toolConfig };
}

// --- Redirect resolution ---

async function resolveRedirectUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.url;
  } catch {
    return url;
  }
}

// --- Response conversion: Gemini -> OpenAI ---

async function convertResponse(geminiResponse: any, model: string): Promise<any> {
  const candidate = geminiResponse.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  // Extract text parts (filter out thinking parts, but keep response parts with thoughtSignature)
  const textParts = parts
    .filter((p: any) => p.text && !p.thought)
    .map((p: any) => p.text);
  const content = textParts.length > 0 ? textParts.join("") : null;

  // Extract function calls (custom tools that need client-side execution)
  const toolCalls: any[] = [];
  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({
        id: part.functionCall.id ?? `fc_${Math.random().toString(36).slice(2, 10)}`,
        type: "function" as const,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
    }
  }

  // Convert grounding metadata -> annotations (url_citation format)
  // Resolve vertex redirect URLs to real destination URLs in parallel
  const grounding = candidate?.groundingMetadata;
  const redirectChunks = (grounding?.groundingChunks ?? []).filter((c: any) => c.web);
  const resolvedUrls = await Promise.all(
    redirectChunks.map((c: any) => resolveRedirectUrl(c.web.uri ?? "")),
  );
  const annotations = redirectChunks.map((chunk: any, i: number) => ({
    type: "url_citation",
    url_citation: {
      url: resolvedUrls[i],
      title: chunk.web.title ?? "",
    },
  }));

  // Extract native tool metadata from toolCall parts (present with includeServerSideToolInvocations)
  const toolCallSearchQueries = parts
    .filter((p: any) => p.toolCall?.toolType === "GOOGLE_SEARCH_WEB")
    .flatMap((p: any) => p.toolCall.args?.queries ?? []);

  const nativeToolMeta: Record<string, any> = {};
  if (toolCallSearchQueries.length > 0) {
    nativeToolMeta.googleSearch = { queries: toolCallSearchQueries };
  } else if (grounding?.webSearchQueries?.length) {
    const queries = grounding.webSearchQueries.filter((q: string) => q.length > 0);
    if (queries.length > 0) {
      nativeToolMeta.googleSearch = { queries };
    }
  }

  // Cost calculation
  const usage = geminiResponse.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  const groundingQueryCount = grounding?.webSearchQueries?.filter((q: string) => q.length > 0).length ?? 0;
  const searchQueries = Math.max(toolCallSearchQueries.length, groundingQueryCount);
  const cost = calculateGeminiCost(inputTokens, outputTokens, searchQueries);

  // Build OpenAI-compatible message
  const message: any = {
    role: "assistant",
    content,
    // Stash raw Gemini parts for multi-turn conversation fidelity
    _rawGeminiParts: parts,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (annotations.length > 0) message.annotations = annotations;
  if (Object.keys(nativeToolMeta).length > 0) message._nativeToolMeta = nativeToolMeta;

  return {
    id: geminiResponse.responseId ?? `gemini_${Date.now()}`,
    object: "chat.completion",
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: usage?.totalTokenCount ?? inputTokens + outputTokens,
      cost: cost.cost,
    },
  };
}

// --- Main entry point ---

export async function geminiCreate(params: {
  model: string;
  messages: any[];
  tools?: any[];
  [key: string]: any;
}): Promise<any> {
  const { systemInstruction, contents } = convertMessages(params.messages);
  const { geminiTools, toolConfig } = convertTools(params.tools ?? []);

  const config: any = {};
  if (geminiTools.length > 0) config.tools = geminiTools;
  if (toolConfig) config.toolConfig = toolConfig;
  if (systemInstruction) config.systemInstruction = systemInstruction;

  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().models.generateContent({
        model: params.model,
        contents,
        config: Object.keys(config).length > 0 ? config : undefined,
      });
      return await convertResponse(response, params.model);
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[gemini] Retryable error (attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${params.model}): ${err.message?.slice(0, 200)}. Retrying in ${backoff}ms...`,
        );
        await sleep(backoff);
        continue;
      }
      if (err instanceof Error) {
        err.message = `[gemini model: ${params.model}] ${err.message}`;
      }
      throw err;
    }
  }
  throw lastError;
}
