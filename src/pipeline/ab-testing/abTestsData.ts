/**
 * Pure-data half of the A/B test framework. The runtime helpers
 * (`runABTests`, `withForcedPicks`, `resolvePicks`, …) live in
 * `abTests.ts` because they pull in `node:async_hooks`. This file is
 * browser-safe — only `import type` references to BotConfig — so the
 * dashboards can pull `AB_TESTS` in directly to derive slot/variant
 * declaration order.
 */

import type { BotConfig, ScoreFilter } from "./botConfig";

// --- Types ---

/**
 * A prerequisite value is either the exact value to match (===) or a list of
 * acceptable values (membership). Disjunctions like `botId: ["agent",
 * "multi-agent"]` work without predicate functions.
 */
export type Prerequisites = {
  [K in keyof BotConfig]?: BotConfig[K] | BotConfig[K][];
};

export interface ABVariant {
  /** Tag stored under ab_test_picks[testName]. */
  name: string;
  overrides: Partial<BotConfig>;
}

export interface ABTest {
  /** Key in ab_test_picks. */
  name: string;
  /** Optional gate. Test is skipped (no entry in picks) when prerequisites mismatch. */
  prerequisites?: Prerequisites;
  variants: { variant: ABVariant; weight: number }[];
  /**
   * Variant to assume when a `pipeline_runs.ab_test_picks` dict lacks this
   * test's key — e.g. for rows written before the test existed. Consumers
   * must read picks through `getPick` / `resolvePicks` for this to apply.
   *
   * Leave unset for prereq-gated tests: "missing" there means "the test
   * didn't fire," and the helpers can't tell that apart from "the test
   * didn't exist yet."
   */
  defaultVariant?: string;
}

// --- AB_TESTS data ---

const AGENT_FAMILY_SCORE_FILTERS: ScoreFilter[] = [
  { score: "noteNotNeeded", op: "gte", threshold: 0.7 },
];

export const BOT_TEST: ABTest = {
  name: "bot",
  variants: [
    { variant: { name: "simple-bot",  overrides: { botId: "simple-bot" }}, weight: 100 },
    { variant: { name: "multi-agent", overrides: {
      botId: "multi-agent",
      model: "google/gemini-3-flash-preview",
      scoreFilters: AGENT_FAMILY_SCORE_FILTERS,
    }}, weight: 0 },
    { variant: { name: "agent", overrides: {
      botId: "agent",
      model: "google/gemini-3-flash-preview",
      scoreFilters: AGENT_FAMILY_SCORE_FILTERS,
    }}, weight: 0 },
    { variant: { name: "opus-main",                  overrides: { botId: "opus-main" }},                 weight: 0 },
    { variant: { name: "opus-main-v2",               overrides: { botId: "opus-main-v2" }},              weight: 0 },
    { variant: { name: "opus-main-no-source-check",  overrides: { botId: "opus-main-no-source-check" }}, weight: 0 },
    { variant: { name: "opus-direct",                overrides: { botId: "opus-direct" }},               weight: 0 },
    { variant: { name: "opus-direct-grok",           overrides: { botId: "opus-direct-grok" }},          weight: 0 },
    { variant: { name: "opus-main-v2-grok",          overrides: { botId: "opus-main-v2-grok" }},         weight: 0 },
    { variant: { name: "opus-multi-source",          overrides: { botId: "opus-multi-source" }},         weight: 0 },
    { variant: { name: "opus-bridging",              overrides: { botId: "opus-bridging" }},             weight: 0 },
    { variant: { name: "opus-research",              overrides: { botId: "opus-research" }},             weight: 0 },
  ],
};

// Variants for simple-bot ship at the existing 100% sonnet46-native split.
// Other archs land variant-by-variant in commits 4-7 with non-zero weights.
const SIMPLE_BOT_SEARCH_TEST: ABTest = {
  name: "simple_bot_search",
  prerequisites: { botId: "simple-bot" },
  variants: [
    // Uniform weights across every variant except haiku45-native. Each gets
    // ~7.69% of simple-bot traffic (1/13). Haiku stays at 0 — code path is the
    // same as sonnet46-native, no novel signal to gather.
    { variant: { name: "sonnet46-native",         overrides: { search_model: "anthropic/claude-sonnet-4.6",       web_search: "native" }},        weight: 5 },
    { variant: { name: "haiku45-native",          overrides: { search_model: "anthropic/claude-haiku-4.5",        web_search: "native" }},        weight: 0 },
    { variant: { name: "grok43-native",           overrides: { search_model: "x-ai/grok-4.3",                     web_search: "native_grok" }},   weight: 2 },
    { variant: { name: "gemini3flash-native",     overrides: { search_model: "google/gemini-3-flash-preview",     web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "gemini35flash-native",    overrides: { search_model: "google/gemini-3.5-flash",           web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "gemini3pro-native",       overrides: { search_model: "google/gemini-3-pro-preview",       web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "sonar-reasoning-pro",     overrides: { search_model: "perplexity/sonar-reasoning-pro",    web_search: "bundled" }},       weight: 2 },
    { variant: { name: "sonar-pro",               overrides: { search_model: "perplexity/sonar-pro",              web_search: "bundled" }},       weight: 0 },
    { variant: { name: "kimi-k26-searxng",        overrides: { search_model: "moonshotai/kimi-k2.6",              web_search: "searxng" }},       weight: 0 },
    { variant: { name: "deepseek-v4pro-searxng",  overrides: { search_model: "deepseek/deepseek-v4-pro",          web_search: "searxng" }},       weight: 0 },
    { variant: { name: "deepseek-v4flash-searxng",overrides: { search_model: "deepseek/deepseek-v4-flash",        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "glm5-searxng",            overrides: { search_model: "z-ai/glm-5",                        web_search: "searxng" }},       weight: 2 },
    { variant: { name: "deepseek-v32exp-searxng", overrides: { search_model: "deepseek/deepseek-v3.2-exp",        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "qwen3max-searxng",        overrides: { search_model: "qwen/qwen3-max",                    web_search: "searxng" }},       weight: 0 },
    { variant: { name: "gpt5_4mini-native",       overrides: { search_model: "openai/gpt-5.4-mini",               web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5-native",             overrides: { search_model: "openai/gpt-5",                      web_search: "native_openai" }}, weight: 1 },
    { variant: { name: "mistral-large-3-searxng", overrides: { search_model: "mistralai/mistral-large-2512",      web_search: "searxng" }},       weight: 1 },
  ],
};

const SIMPLE_BOT_WRITER_TEST: ABTest = {
  name: "simple_bot_writer",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "sonnet",           overrides: { writer_model: "anthropic/claude-sonnet-4.6"   }}, weight: 50 },
    { variant: { name: "gemini-flash",     overrides: { writer_model: "google/gemini-3-flash-preview" }}, weight: 50 },
    { variant: { name: "deepseek-v4flash", overrides: { writer_model: "deepseek/deepseek-v4-flash"    }}, weight: 0 },
  ],
};

// Verifier is hardcoded to Gemini-flash via DEFAULT_CONFIG.verifier_model.
// Add SIMPLE_BOT_VERIFIER_TEST later when comparing verifiers.

// Extra LLM step between writer and source verifier that judges whether the
// proposed note is actually warranted. When "on", the search step's system
// prompt is simplified (criteria for "when a note is needed" move into the
// judge's prompt). Prereq-gated to simple-bot, so no defaultVariant.
const NOTE_NEEDED_JUDGE_TEST: ABTest = {
  name: "note_needed_judge",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off",              overrides: { note_needed_judge: false }                                                                 }, weight: 100 },
    { variant: { name: "deepseek-v4flash", overrides: { note_needed_judge: true, note_judge_model: "deepseek/deepseek-v4-flash" }                  }, weight: 0 },
  ],
};

const VERIFIER_MEDIA_SOURCES_TEST: ABTest = {
  name: "verifier_media_sources",
  variants: [
    { variant: { name: "reject", overrides: { verifier_accepts_media_sources: false } }, weight: 50 },
    { variant: { name: "accept", overrides: { verifier_accepts_media_sources: true  } }, weight: 50 },
  ],
};

const AGENT_SEARCH_TEST: ABTest = {
  name: "agent_search",
  prerequisites: { botId: ["agent", "multi-agent"] },
  variants: [
    { variant: { name: "perplexity", overrides: { web_search: "perplexity" }},          weight: 1 },
    { variant: { name: "searxng",    overrides: { web_search: "searxng" }},             weight: 1 },
    { variant: { name: "searxngsum", overrides: { web_search: "searxng_summarized" }},  weight: 1 },
  ],
};

const AGENT_PARALLEL_TEST: ABTest = {
  name: "agent_parallel",
  prerequisites: { botId: ["agent", "multi-agent"] },
  variants: [
    { variant: { name: "seq", overrides: { parallel_research: false }}, weight: 1 },
    { variant: { name: "par", overrides: { parallel_research: true }},  weight: 1 },
  ],
};

// Pseudo A/B test: records the feed size in `pipeline_runs.ab_test_picks.feed_size`.
// `generateCandidates` forces the pick to the size the fetch actually used.
// Pre-existing rows (no `feed_size` key) resolve to "small".
const FEED_SIZE_TEST: ABTest = {
  name: "feed_size",
  defaultVariant: "small",
  variants: [
    { variant: { name: "small", overrides: { feed_size: "small" }}, weight: 100 },
    { variant: { name: "large", overrides: { feed_size: "large" }}, weight: 0 },
    { variant: { name: "xl",    overrides: { feed_size: "xl"    }}, weight: 0 },
    { variant: { name: "xxl",   overrides: { feed_size: "xxl"   }}, weight: 0 },
  ],
};

export const AB_TESTS: ABTest[] = [
  BOT_TEST,
  SIMPLE_BOT_SEARCH_TEST,
  SIMPLE_BOT_WRITER_TEST,
  NOTE_NEEDED_JUDGE_TEST,
  VERIFIER_MEDIA_SOURCES_TEST,
  AGENT_SEARCH_TEST,
  AGENT_PARALLEL_TEST,
  FEED_SIZE_TEST,
];
