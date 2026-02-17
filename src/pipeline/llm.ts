import OpenAI from "openai";

let _llm: OpenAI.Chat.Completions | undefined;

export function getLlm(): OpenAI.Chat.Completions {
  if (!_llm) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error(
        "OPENROUTER_API_KEY environment variable is required but not set"
      );
    }
    _llm = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    }).chat.completions;
  }
  return _llm;
}

// Backwards-compatible: existing code uses `llm.create(...)` directly
// This proxy defers the env var check until first actual LLM call
export const llm = new Proxy({} as OpenAI.Chat.Completions, {
  get(_target, prop) {
    return (getLlm() as any)[prop];
  },
});
