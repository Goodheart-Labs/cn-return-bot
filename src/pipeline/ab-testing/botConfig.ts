import { AsyncLocalStorage } from "node:async_hooks";
import type { MisinfoTopicId } from "../misinfo-monitoring/topicIds";

// --- Config type ---

export type VideoDescriptionStrategy = "full_video" | "frames";

export interface BotConfig {
  /** Which bot to run. The BOT_TEST A/B test sets this. A caller can also force
   *  it with withForcedPicks. */
  botId: string;
  model: string;
  /** Step-specific model overrides. Each defaults to `model` when unset. */
  search_model?: string;
  /** Model for the prefilter's search analyzer. When it is unset the analyzer
   *  uses `search_model`, and when that is unset too it uses `model`. The query
   *  writer also reads `search_model`. This field exists so the analyzer and the
   *  query writer can run on different models. */
  search_analyzer_model?: string;
  writer_model?: string;
  /** Model for the source verifier. DEFAULT_CONFIG sets it to
   *  gemini-3-flash-preview. No dedicated A/B test varies it. */
  verifier_model?: string;
  /**
   * When this is true, the source verifier can judge a cited media URL. It runs
   * an automated Gemini analysis of the media and treats the result as the
   * source's content. Video, audio, and Instagram photos are downloaded with
   * yt-dlp. A plain image URL goes straight to a vision call. Defaults to false.
   */
  verifier_accepts_media_sources?: boolean;
  /**
   * When this is true, the source verifier runs a two-call claim-based flow. The
   * first call extracts the note's distinct factual claims. The second call maps
   * each claim to the cited sources that support it. A source counts as good when
   * it supports at least one claim. The note is accepted when every claim has at
   * least one supporting source. Defaults to false, which is the single-call
   * accept-or-reject flow. VERIFIER_CLAIM_BASED_TEST sets this.
   */
  verifier_claim_based?: boolean;
  /**
   * When this is true, the source verifier first collects the most relevant
   * verbatim snippets for each source. It also writes a plain-language note on
   * how each source supports or fails to support the note. Only then does it
   * judge the source good or bad. This applies to both the classic flow and the
   * claim-based flow. The snippets are surfaced as `source_evaluations` on the
   * result and in the tweet log. They do not change which URLs the published note
   * carries. VERIFIER_CITATIONS_TEST sets this and it defaults to false.
   */
  verifier_citations?: boolean;
  /** Model for the note-needed-judge step. Defaults to `model` when unset. */
  note_judge_model?: string;
  /**
   * When this is true, simple-bot runs an LLM step between search and writer.
   * That step extracts atomic corrections from the search findings and grades
   * each one as clear_error, minor_error, critical_context, useful_context, or
   * not_useful. The writer then receives only the high-value ones, which are the
   * clear_error and critical_context corrections, instead of the raw findings. If
   * none of them grade high, the run exits early as no_correction. This applies
   * to simple-bot only. SIMPLE_BOT_CORRECTION_EXTRACTION_TEST sets it and it
   * defaults to false.
   */
  correction_extraction?: boolean;
  /** Model for the correction-extractor step. Defaults to `model` when unset. */
  correction_extraction_model?: string;
  /**
   * When this is true, a cheap deepseek-v4-flash note-needed prefilter runs
   * before the bot. The prefilter is its own small chain: a query writer, then
   * the Serper search, then the analyzer, then a reframed note-needed judge. If it decides
   * no note is needed, the bot is skipped and the run is recorded as rejected
   * with the reason prefilter_no_note. This is what lets us screen a large feed
   * cheaply. NOTE_PREFILTER_TEST sets it and it defaults to false.
   */
  note_prefilter?: boolean;
  /**
   * When this is true, a blocked-topic gate runs before everything else,
   * including the note-needed prefilter. One deepseek-v4-flash call checks the
   * post against BLOCKED_TOPICS. On a hit the run is skipped and recorded as
   * rejected with the reason blocked_topic. TOPIC_FILTER_TEST sets it and it
   * defaults to false.
   */
  topic_filter?: boolean;
  /**
   * When this is set, it is passed through to OpenRouter as `reasoning_effort`
   * for every LLM call this bot makes. It is useful when the configured model
   * supports test-time reasoning, for example deepseek-v4-flash with extended
   * reasoning. When it is unset the parameter is left out entirely.
   */
  reasoning_effort?: "low" | "medium" | "high";
  /**
   * When this is set, it is passed as `reasoning_effort` on the simple-bot search
   * call only, which is the Anthropic-native path. Unlike `reasoning_effort` it
   * leaves the writer, verifier, and judge calls untouched. That lets a search
   * A/B arm vary reasoning without confounding the other stages. When it is unset
   * the model's own default applies, and Claude models do not reason by default.
   * SIMPLE_BOT_SEARCH_TEST sets it.
   */
  search_reasoning_effort?: "low" | "medium" | "high";
  /**
   * When this is set, it is passed through to OpenRouter as `temperature` for
   * every LLM call this bot makes. The note-needed prefilter pins it to 0, so
   * its decisions are deterministic enough to hill-climb. On the retired
   * cheap-bot, the model's default temperature flipped about 58% of eval rows
   * from one run to the next. When this is unset the model's own default
   * applies.
   */
  temperature?: number;
  web_search:
    | "native"             // Anthropic web_search runs through OpenRouter.
    | "native_gemini"      // Google's native Gen AI API runs with its googleSearch tool.
    | "native_grok"        // The native xAI API runs with xSearch.
    | "native_openai"      // The OpenAI Responses API runs web_search_preview through OpenRouter.
    | "bundled"            // Perplexity Sonar has search built into the model.
    | "perplexity"         // The model calls Perplexity as a tool.
    | "serper"             // A tool-calling loop calls google_search for raw Serper results.
    | "serper_summarized"; // A tool-calling loop calls google_search, and Gemini summarizes the Serper results.
  video_description_strategy: VideoDescriptionStrategy;
  parallel_research: boolean;
  /**
   * When this is true, simple-bot's search agent uses the "anti-pedantic" prompt
   * variant. That variant flags a correction only when the post's main claim or
   * argument is wrong, and not when a minor side detail is wrong. This applies to
   * simple-bot only. SIMPLE_BOT_ANTI_PEDANTIC_TEST sets it and it defaults to
   * false.
   */
  search_anti_pedantic?: boolean;
  /**
   * When this is true, both simple-bot's search prompt and its writer prompt gain
   * the time-travel test. A correction must have been accurate and fair at the
   * moment the post was published. A claim that only later events made outdated
   * is not an error. This was backtested on 2026-07-28. See
   * docs/improvement-menu-2026-07-25.md, item T2. This applies to simple-bot
   * only. TIME_TRAVEL_PROMPT_TEST sets it and it defaults to false.
   */
  time_travel_prompt?: boolean;
  /**
   * When this is true, simple-bot runs an extractor after search that measures
   * the gap between the event the post describes and the moment the post was
   * published. A post published within 6 hours of the event, or while the event
   * was still going on, counts as a fog-window post. Such a post gets a
   * timing-context block piped into the writer's user message, plus a
   * pre-computed Post-age line. This is information for the writer, not a gate.
   * It is independent of time_travel_prompt, so the two form a 2x2. This applies
   * to simple-bot only. TIMING_CONTEXT_TEST sets it and it defaults to false.
   */
  timing_context?: boolean;
  /**
   * When this is true, simple-bot's search step uses the claim-check prompt. The
   * input is then a claim extracted from a podcast, an interview, or an article,
   * together with its surrounding context, rather than an X post. The everything
   * pipeline forces this on. This applies to simple-bot only.
   * SIMPLE_BOT_CLAIM_TEST sets it and it defaults to false.
   */
  search_claim?: boolean;
  /**
   * The misinfo topic this run matched, when it came from the XXL-feed misinfo
   * pre-pass. This mirrors the forced misinfo_topic pick into the config, so
   * tests declared later can gate on specific topics through their
   * prerequisites. MISINFO_TOPIC_TEST sets it. On a regular run it stays
   * unset.
   */
  misinfo_topic?: MisinfoTopicId;
  /**
   * When this is true, the run is on the "on" arm of the concede-then-correct
   * experiment for curated misinfo topics. The reference document keeps its
   * marker-wrapped experiment additions, which are the "Note shape — concede
   * the true core first" section and the "True core" line of each claim. The
   * writer also appends MISINFO_CONCEDE_SHAPE_RULE to its system prompt. When
   * this is false or unset, buildReferenceBlock strips those additions, and the
   * run sees the document exactly as it was before the experiment.
   * MISINFO_CONCEDE_SHAPE_TEST sets it, only on the topics enrolled in
   * CONCEDE_SHAPE_TOPIC_IDS. It defaults to false.
   */
  concede_shape?: boolean;
  /**
   * When this is true, the writer's user message includes a block of the post
   * author's past helpful community notes. That block holds both our own notes
   * and competing notes on tweets we have noted. See getAuthorNoteHistory. The
   * lookup was silently broken from migration 033 until June 2026, because it
   * queried the pipeline_runs.author_id column after that column had been
   * dropped. So this input was effectively off that whole time.
   * AUTHOR_HISTORY_TEST now sets it, and both of its live arms turn it on.
   * Nothing gates it on a prerequisite, so it runs for every bot. Defaults to
   * false.
   */
  author_history?: boolean;
  /**
   * When this is true, the author-history block also lists past notes on this
   * author's posts that raters rejected, both our own and competing ones. That is
   * a warning that this author's posts may be satire or opinion the community
   * does not want noted. It only means anything alongside author_history. The
   * `on_with_unhelpful` arm of AUTHOR_HISTORY_TEST sets both. Defaults to false.
   */
  author_history_unhelpful?: boolean;
  /**
   * The lowest X eval score (`claim_opinion_score`) at which a note is still
   * submitted. A missing value falls back to 0, which preserves older ad-hoc
   * script configs. EVAL_SUBMIT_THRESHOLD_TEST sets it.
   */
  eval_submit_threshold?: number;
}

// --- Default config ---

export const DEFAULT_CONFIG: BotConfig = {
  botId: "<unset>",
  model: "anthropic/claude-sonnet-4.6",
  verifier_model: "google/gemini-3-flash-preview", // simple-bot has always verified with gemini-flash.
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
 * Per-call LLM tuning derived from the bot config. It covers `reasoning_effort`
 * and `temperature`. Each one is left out when it is unset, so the model's own
 * default applies. Spread the result into every `trackedLlmCreate` params object
 * so a bot's tuning applies uniformly across all of its pipeline stages.
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
