import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";
import { calculateGrokCost, type TokenCost } from "../utils/pricing";

if (!process.env.XAI_API_KEY) {
  console.warn("XAI_API_KEY not set - Grok X search will not be available");
}

export const xai = createXai({
  apiKey: process.env.XAI_API_KEY,
});

// --- Single-call native helper for simple-bot search ---

export interface XaiNativeParams {
  /** xAI model id (e.g. "grok-4.3", "grok-4-fast"). */
  model: string;
  systemPrompt?: string;
  userMessage: string;
  enableXSearch?: boolean;
  /**
   * JSON shape the model is asked to produce. The Vercel AI SDK doesn't pair
   * structured output with tool use cleanly, so we describe the schema in the
   * prompt and JSON.parse the result. Grok-4 reliably returns parseable JSON
   * when asked.
   */
  responseSchema?: object;
}

export interface XaiNativeResult {
  text: string;
  parsed?: any;
  searchCalls: number;
  cost: TokenCost;
}

export async function xaiNativeGenerate(p: XaiNativeParams): Promise<XaiNativeResult> {
  if (!process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY environment variable is required but not set");
  }

  const tools: Record<string, unknown> = {};
  if (p.enableXSearch) {
    tools.x_search = xai.tools.xSearch({ enableImageUnderstanding: true });
  }

  const promptParts: string[] = [];
  if (p.systemPrompt) promptParts.push(p.systemPrompt);
  promptParts.push(p.userMessage);
  if (p.responseSchema) {
    promptParts.push(
      `\nRespond with strict JSON only matching this schema:\n${JSON.stringify(p.responseSchema)}`,
    );
  }

  const result = await generateText({
    model: xai.responses(p.model) as any,
    prompt: promptParts.join("\n\n"),
    tools: Object.keys(tools).length > 0 ? (tools as any) : undefined,
  });

  const text = result.text ?? "";
  let parsed: any | undefined;
  if (p.responseSchema) {
    const cleaned = text.replace(/^```json\n?|\n?```$/g, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // caller handles missing parsed
    }
  }

  const searchCalls = result.steps?.reduce(
    (n, s) => n + (s.toolCalls?.filter((tc) => tc.toolName === "x_search").length ?? 0),
    0,
  ) ?? 0;

  const cost = calculateGrokCost(
    result.usage?.inputTokens ?? 0,
    result.usage?.outputTokens ?? 0,
    searchCalls,
    p.model,
  );

  return { text, parsed, searchCalls, cost };
}
