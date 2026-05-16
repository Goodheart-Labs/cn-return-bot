import { AsyncLocalStorage } from "node:async_hooks";
import type { AllNoteScores } from "../score/noteScores";

// --- Config type ---

export type VideoDescriptionStrategy = "full_video" | "frames";

export interface ScoreFilter {
  score: keyof AllNoteScores;
  op: "gte" | "lte";
  threshold: number;
}

export interface BotConfig {
  /** Which bot to run. Set by the BOT_TEST A/B test (or forced via withForcedPicks). */
  botId: string;
  model: string;
  /** Step-specific model overrides. Each defaults to `model` when unset. */
  search_model?: string;
  writer_model?: string;
  /** Defaults to gemini-3-flash-preview via DEFAULT_CONFIG (no A/B test). */
  verifier_model?: string;
  /** If true, the source verifier surfaces an automated Gemini analysis (yt-dlp for video/audio/Instagram-photo, direct vision call for image URLs) for cited media URLs and treats that as the source's content. Defaults to false. */
  verifier_accepts_media_sources?: boolean;
  /** If true, before describing tweet media we run a Yandex reverse-image-search + DINO cosine-similarity pass and prepend the matches to the description prompt as additional (fallible) context. For videos, runs on 5 random frames. Defaults to false. */
  reverse_image_search?: boolean;
  web_search:
    | "native"             // Anthropic web_search via OpenRouter
    | "native_gemini"      // Google Gen AI native API + googleSearch tool
    | "native_grok"        // xAI native + xSearch
    | "native_openai"      // OpenAI Responses API + web_search_preview tool (via OpenRouter)
    | "bundled"            // Perplexity Sonar — search baked in
    | "perplexity"         // Perplexity-as-tool
    | "searxng"            // tool-calling loop: model calls google_search (raw SearXNG)
    | "searxng_summarized";// tool-calling loop: model calls google_search (SearXNG → Gemini summary)
  video_description_strategy: VideoDescriptionStrategy;
  scoreFilters: ScoreFilter[];
  parallel_research: boolean;
}

// --- Default config ---

export const DEFAULT_CONFIG: BotConfig = {
  botId: "<unset>",
  model: "anthropic/claude-sonnet-4.6",
  verifier_model: "google/gemini-3-flash-preview", // simple-bot has always verified with gemini-flash
  web_search: "perplexity",
  video_description_strategy: "frames",
  scoreFilters: [],
  parallel_research: false,
};

// --- AsyncLocalStorage ---

const configStorage = new AsyncLocalStorage<BotConfig>();

export function withBotConfig<T>(config: BotConfig, fn: () => T): T {
  return configStorage.run(config, fn);
}

export function getBotConfig(): BotConfig {
  const config = configStorage.getStore();
  if (!config) throw new Error("getBotConfig() called outside withBotConfig()");
  return config;
}
