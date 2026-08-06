import { AsyncLocalStorage } from "node:async_hooks";

// --- Config type ---

export type VideoDescriptionStrategy = "full_video" | "frames";

export interface BotConfig {
  /** Which bot to run. Set by the BOT_TEST A/B test (or forced via withForcedPicks). */
  botId: string;
  model: string;
  /** Step-specific model overrides. Each defaults to `model` when unset. */
  search_model?: string;
  /** Model for the cheap-bot search analyzer. Defaults to `search_model` then
   *  `model`. Decouples the analyzer from the query writer (which also reads
   *  `search_model`) so they can run on different models. */
  search_analyzer_model?: string;
  writer_model?: string;
  /** Defaults to gemini-3-flash-preview via DEFAULT_CONFIG (no A/B test). */
  verifier_model?: string;
  /** If true, the source verifier surfaces an automated Gemini analysis (yt-dlp for video/audio/Instagram-photo, direct vision call for image URLs) for cited media URLs and treats that as the source's content. Defaults to false. */
  verifier_accepts_media_sources?: boolean;
  /**
   * If true, the source verifier runs the two-call claim-based flow: one call
   * extracts the note's distinct factual claims, a second maps each claim to the
   * cited sources that support it. A source is "good" iff it supports ≥1 claim;
   * the note is accepted iff every claim has ≥1 supporting source. Defaults to
   * false (the single-call accept/reject flow). Set by VERIFIER_CLAIM_BASED_TEST.
   */
  verifier_claim_based?: boolean;
  /**
   * When true, the source verifier collects, per source, the most relevant
   * verbatim snippets + a plain-language note on how each supports or fails to
   * support the note BEFORE judging good/bad (reason-then-judge). Applies to both
   * the classic and claim-based flows. Surfaced as `source_evaluations` on the
   * result + tweet log; does not change which URLs the published note carries.
   * Set by VERIFIER_CITATIONS_TEST; defaults false.
   */
  verifier_citations?: boolean;
  /**
   * When true, the pipeline runs an extra LLM step between writer and source
   * verifier that judges whether a note is actually warranted for the post.
   * cheap-bot's primary FP guard (always on there via BOT_TEST). Defaults to
   * false (no judge step).
   */
  note_needed_judge?: boolean;
  /** Model for the note-needed-judge step. Defaults to `model` when unset. */
  note_judge_model?: string;
  /**
   * When true (simple-bot only), an LLM step between search and writer extracts
   * atomic corrections from the search findings, grades each (clear_error /
   * minor_error / critical_context / useful_context / not_useful), and passes the
   * writer only the high-value ones (clear_error + critical_context) instead of
   * the raw findings. If none grade high, the run early-exits as no_correction.
   * Set by SIMPLE_BOT_CORRECTION_EXTRACTION_TEST; defaults false.
   */
  correction_extraction?: boolean;
  /** Model for the correction-extractor step. Defaults to `model` when unset. */
  correction_extraction_model?: string;
  /**
   * When true, a cheap deepseek-v4-flash "note-needed prefilter" runs BEFORE the
   * bot (query writer → SearXNG → analyzer → reframed note-needed judge). If it
   * decides no note is needed, the bot is skipped and the run is recorded as
   * rejected / prefilter_no_note. Lets a large feed be screened cheaply. Set by
   * NOTE_PREFILTER_TEST; defaults false.
   */
  note_prefilter?: boolean;
  /**
   * When true, a blocked-topic gate runs before everything else (even the
   * note-needed prefilter): one deepseek-v4-flash call checks the post against
   * BLOCKED_TOPICS and skips the run (rejected / blocked_topic) on a hit. Set
   * by TOPIC_FILTER_TEST; defaults false.
   */
  topic_filter?: boolean;
  /** Model for the cheap-bot satire detector. Defaults to `note_judge_model`
   *  then `model`. Decouples the satire detector from the note-needed judge
   *  (which also reads `note_judge_model`) so they can run on different models. */
  satire_model?: string;
  /**
   * If set, passed through to OpenRouter as `reasoning_effort` for every LLM
   * call made by this bot. Useful when the configured model supports test-time
   * reasoning (e.g. deepseek-v4-flash with extended reasoning). Falsy = omit.
   */
  reasoning_effort?: "low" | "medium" | "high";
  /**
   * If set, passed as `reasoning_effort` on the simple-bot SEARCH call only
   * (Anthropic-native path). Unlike `reasoning_effort` this leaves the
   * writer/verifier/judge calls untouched, so a search A/B arm can vary
   * reasoning without confounding the other stages. Unset = model default
   * (Claude models don't reason by default). Set by SIMPLE_BOT_SEARCH_TEST.
   */
  search_reasoning_effort?: "low" | "medium" | "high";
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
  /**
   * When true (simple-bot only), the search agent's system prompt is appended
   * with an instruction to prefer, for political posts, sources associated with
   * the post author's own political side — the bridging idea that a note is more
   * likely to be rated helpful when it cites sources the author's audience
   * already trusts. Set by SIMPLE_BOT_POLITICAL_SOURCES_TEST; defaults false.
   */
  search_political_sources?: boolean;
  /**
   * When true (simple-bot only), the search agent uses the "anti-pedantic"
   * prompt variant, which only flags a correction when the post's main claim /
   * argument is wrong (not a minor side error). Set by
   * SIMPLE_BOT_ANTI_PEDANTIC_TEST; defaults false.
   */
  search_anti_pedantic?: boolean;
  /**
   * When true (simple-bot only), the search AND writer prompts gain the
   * time-travel test: a correction must have been accurate and fair at the
   * moment the post was published — a claim outdated only by later events is
   * not an error. Backtested 2026-07-28 (docs/improvement-menu-2026-07-25.md,
   * T2). Set by TIME_TRAVEL_PROMPT_TEST; defaults false.
   */
  time_travel_prompt?: boolean;
  /**
   * When true (simple-bot only), a post-search extractor measures the gap
   * between the post's event and the post's publication; fog-window posts
   * (published within 6h of the event, or mid-event) get a timing-context
   * block piped into the writer's user message plus a pre-computed Post-age
   * line. Information, not a gate. Independent of time_travel_prompt (2x2).
   * Set by TIMING_CONTEXT_TEST; defaults false.
   */
  timing_context?: boolean;
  /**
   * When true (simple-bot only), the search step uses the claim-check prompt —
   * the input is a claim extracted from a podcast, interview, or article plus
   * surrounding context, not an X post. Forced on by the everything pipeline.
   * Set by SIMPLE_BOT_CLAIM_TEST; defaults false.
   */
  search_claim?: boolean;
  /**
   * When true, the writer's system prompt is appended with a few-shot block of
   * real notes the community rated helpful — all simple, direct, and short — to
   * pull the writer toward that "simple and nice" style. Set by
   * SIMPLE_BOT_WRITER_EXAMPLES_TEST; defaults false.
   */
  writer_examples?: boolean;
  /**
   * When true, the writer's user message includes a block of the post author's
   * past helpful community notes (ours + competing notes on tweets we've noted)
   * as context — see getAuthorNoteHistory. The lookup was silently broken from
   * migration 033 until June 2026 (it queried the dropped pipeline_runs.author_id
   * column), so this input was effectively off the whole time. Now a 50/50 A/B
   * test via AUTHOR_HISTORY_TEST. Not prereq-gated — runs for every bot. Defaults false.
   */
  author_history?: boolean;
  /**
   * When true, the author-history block ALSO lists past notes on this author's
   * posts that raters rejected (ours + competing) — a warning that this author's
   * posts may be satire or opinion the community doesn't want noted. Only
   * meaningful alongside author_history; the AUTHOR_HISTORY_TEST
   * `on_with_unhelpful` arm sets both. Defaults false.
   */
  author_history_unhelpful?: boolean;
  /**
   * Minimum X eval-score (`claim_opinion_score`) at which a note is submitted.
   * Missing values fall back to 0, preserving older ad-hoc script configs.
   * Set by EVAL_SUBMIT_THRESHOLD_TEST.
   */
  eval_submit_threshold?: number;
}

// --- Default config ---

export const DEFAULT_CONFIG: BotConfig = {
  botId: "<unset>",
  model: "anthropic/claude-sonnet-4.6",
  verifier_model: "google/gemini-3-flash-preview", // simple-bot has always verified with gemini-flash
  web_search: "perplexity",
  video_description_strategy: "frames",
  parallel_research: false,
  eval_submit_threshold: 0,
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
