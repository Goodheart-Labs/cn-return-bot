import { createXai } from "@ai-sdk/xai";

if (!process.env.XAI_API_KEY) {
  console.warn("XAI_API_KEY not set - Grok X search will not be available");
}

export const xai = createXai({
  apiKey: process.env.XAI_API_KEY,
});
