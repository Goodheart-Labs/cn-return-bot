import OpenAI from "openai";

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error(
    "OPENROUTER_API_KEY environment variable is required but not set"
  );
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const llm = openai.chat.completions;
