import { AsyncLocalStorage } from "node:async_hooks";

// --- Config type ---

export type VideoDescriptionStrategy = "full_video" | "frames";

/** Feed sizes accepted by X's eligible-posts API. */
export type FeedSize = "small" | "large" | "xl" | "xxl";

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
   * If set, passed through to OpenRouter as `reasoning_effort` for every LLM
   * call made by this bot. Useful when the configured model supports test-time
   * reasoning (e.g. deepseek-v4-flash with extended reasoning). Falsy = omit.
   */
  reasoning_effort?: "low" | "medium" | "high";
  /**
   * If set, passed through to OpenRouter as `temperature` for every LLM call
   * made by this bot. cheap-bot pins this to 0 (via the `cheap_bot_temperature`
   * A/B test) so its judge/verifier/writer decisions are deterministic enough
   * to hill-climb — at default temperature ~58% of eval rows flipped run-to-run.
   * Unset = model default.
   */
  temperature?: number;
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
  parallel_research: boolean;
  /** When true, an LLM step between search and writer distills raw search
   *  snippets into a structured research brief. Defaults to false. */
  search_analyzer?: boolean;
  /**
   * When true (cheap-bot only), a pre-search LLM gate reads the post + comments
   * + author profile — WITHOUT the proposed note — and decides whether the post
   * is overt satire that the audience is in on. A positive verdict early-exits
   * the pipeline with no_correction, skipping search + writer + judge. The
   * detector is high-precision by design (it fires only when the room is in on
   * the joke, not on fabricated content imitating real media), so the
   * note-needed judge keeps a lighter satire backstop for the cases it misses.
   * Defaults to false.
   */
  satire_detector?: boolean;
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

/**
 * Per-call LLM tuning derived from the bot config (reasoning_effort +
 * temperature). Both are omitted when unset so the model's own defaults apply.
 * Spread into every `trackedLlmCreate` params object so a bot's tuning is
 * applied uniformly across its pipeline stages.
 */
export function llmTuningParams(config: BotConfig): {
  reasoning_effort?: "low" | "medium" | "high";
  temperature?: number;
} {
  return {
    ...(config.reasoning_effort ? { reasoning_effort: config.reasoning_effort } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
  };
}
