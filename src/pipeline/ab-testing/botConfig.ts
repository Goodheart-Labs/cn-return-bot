import { AsyncLocalStorage } from "node:async_hooks";
import type { AllNoteScores } from "../score/noteScores";

// --- Config type ---

export type VideoDescriptionStrategy = "full_video" | "frames";

/** Feed sizes accepted by X's eligible-posts API. */
export type FeedSize = "small" | "large" | "xl" | "xxl";

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
  /**
   * When true, the simple-bot pipeline runs an extra LLM step between writer
   * and source verifier that judges whether a note is actually warranted for
   * the post. The search step's system prompt is also simplified — the "when
   * NOT to set correction_needed" criteria move into the judge's prompt.
   * Defaults to false (no judge step, full search prompt).
   */
  note_needed_judge?: boolean;
  /** Model for the note-needed-judge step. Defaults to `model` when unset. */
  note_judge_model?: string;
  /**
   * Strategy for SearXNG-backed search (only consulted when web_search is
   * "searxng" or "searxng_summarized"). `multi_turn` runs the existing
   * tool-calling loop. `single_turn` makes two plain LLM calls: one to plan
   * queries, then SearXNG, then one to synthesize findings — no tool calling.
   * Defaults to `multi_turn` (status quo) when unset.
   */
  searxng_strategy?: "multi_turn" | "single_turn";
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
  /** Feed size used for the eligible-posts fetch. Pseudo A/B test (large=100%). */
  feed_size: FeedSize;
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
  feed_size: "small",
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
