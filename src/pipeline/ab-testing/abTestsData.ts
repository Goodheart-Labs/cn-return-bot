// Browser-safe A/B definitions; runtime helpers live in abTests.ts.
// Weights are relative. Zero-weight variants are force-only, not live traffic.
// Historical labels remain readable even after a definition is removed.
// Test and variant names are persisted keys; renaming them splits the history.
// Closeout numbers and decisions for every test: docs/ab-test-log.md.

import type { BotConfig } from "./botConfig";
import { MISINFO_TOPIC_IDS, CONCEDE_SHAPE_TOPIC_IDS } from "../misinfo-monitoring/topicIds";

export type Prerequisites = {
  [K in keyof BotConfig]?: BotConfig[K] | BotConfig[K][];
};

export interface ABVariant {
  name: string;
  overrides: Partial<BotConfig>;
}

export interface ABTest {
  name: string;
  prerequisites?: Prerequisites;
  variants: { variant: ABVariant; weight: number }[];
  /** Fallback for missing historical picks, not runtime config. Omit on prerequisite-gated tests. */
  defaultVariant?: string;
}

export const BOT_TEST: ABTest = {
  name: "bot",
  variants: [
    { variant: { name: "simple-bot",  overrides: { botId: "simple-bot" }}, weight: 100 },
  ],
};

// Search model/backend comparison. Reasoning arms set search_reasoning_effort.
// Historical -searxng names now replay against Serper, not the removed backend.
const SIMPLE_BOT_SEARCH_TEST: ABTest = {
  name: "simple_bot_search",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "sonnet46-native",         overrides: { search_model: "anthropic/claude-sonnet-4.6",       web_search: "native" }},        weight: 0 },
    { variant: { name: "sonnet5-native",          overrides: { search_model: "anthropic/claude-sonnet-5",         web_search: "native" }},        weight: 4 },
    { variant: { name: "sonnet5-native-medium",   overrides: { search_model: "anthropic/claude-sonnet-5",         web_search: "native", search_reasoning_effort: "medium" }}, weight: 2 },
    { variant: { name: "opus48-native",           overrides: { search_model: "anthropic/claude-opus-4.8",         web_search: "native" }},        weight: 0 },
    { variant: { name: "opus5-native",            overrides: { search_model: "anthropic/claude-opus-5",           web_search: "native" }},        weight: 1 },
    { variant: { name: "opus5-native-medium",     overrides: { search_model: "anthropic/claude-opus-5",           web_search: "native", search_reasoning_effort: "medium" }}, weight: 1 },
    { variant: { name: "haiku45-native",          overrides: { search_model: "anthropic/claude-haiku-4.5",        web_search: "native" }},        weight: 0 },
    { variant: { name: "grok43-native",           overrides: { search_model: "x-ai/grok-4.3",                     web_search: "native_grok" }},   weight: 2 },
    { variant: { name: "grok45-native",           overrides: { search_model: "x-ai/grok-4.5",                     web_search: "native_grok" }},   weight: 2 },
    { variant: { name: "gemini3flash-native",     overrides: { search_model: "google/gemini-3-flash-preview",     web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "gemini35flash-native",    overrides: { search_model: "google/gemini-3.5-flash",           web_search: "native_gemini" }}, weight: 0 },
    { variant: { name: "gemini36flash-native",    overrides: { search_model: "google/gemini-3.6-flash",           web_search: "native_gemini" }}, weight: 2 },
    { variant: { name: "gemini31pro-native",      overrides: { search_model: "google/gemini-3.1-pro-preview",      web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "sonar-reasoning-pro",     overrides: { search_model: "perplexity/sonar-reasoning-pro",    web_search: "bundled" }},       weight: 0 },
    { variant: { name: "sonar-pro",               overrides: { search_model: "perplexity/sonar-pro",              web_search: "bundled" }},       weight: 0 },
    { variant: { name: "kimi-k26-searxng",        overrides: { search_model: "moonshotai/kimi-k2.6",              web_search: "serper" }},       weight: 0 },
    { variant: { name: "kimi-k3-searxng",         overrides: { search_model: "moonshotai/kimi-k3",                web_search: "serper" }},       weight: 0 },
    { variant: { name: "kimi-k3-serper",          overrides: { search_model: "moonshotai/kimi-k3",                web_search: "serper" }},       weight: 2 },
    { variant: { name: "deepseek-v4pro-searxng",  overrides: { search_model: "deepseek/deepseek-v4-pro",          web_search: "serper" }},       weight: 0 },
    { variant: { name: "deepseek-v4flash-searxng",overrides: { search_model: "deepseek/deepseek-v4-flash",        web_search: "serper" }},       weight: 0 },
    { variant: { name: "glm5-searxng",            overrides: { search_model: "z-ai/glm-5",                        web_search: "serper" }},       weight: 0 },
    { variant: { name: "glm52-searxng",           overrides: { search_model: "z-ai/glm-5.2",                      web_search: "serper" }},       weight: 0 },
    { variant: { name: "glm52-serper",            overrides: { search_model: "z-ai/glm-5.2",                      web_search: "serper" }},       weight: 2 },
    { variant: { name: "deepseek-v32exp-searxng", overrides: { search_model: "deepseek/deepseek-v3.2-exp",        web_search: "serper" }},       weight: 0 },
    { variant: { name: "qwen3max-searxng",        overrides: { search_model: "qwen/qwen3-max",                    web_search: "serper" }},       weight: 0 },
    { variant: { name: "gpt5_4mini-native",       overrides: { search_model: "openai/gpt-5.4-mini",               web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5-native",             overrides: { search_model: "openai/gpt-5",                      web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5_6luna-native",       overrides: { search_model: "openai/gpt-5.6-luna",               web_search: "native_openai" }}, weight: 2 },
    { variant: { name: "gpt5_6terra-native",      overrides: { search_model: "openai/gpt-5.6-terra",              web_search: "native_openai" }}, weight: 2 },
    { variant: { name: "gpt5_6sol-native",        overrides: { search_model: "openai/gpt-5.6-sol",                web_search: "native_openai" }}, weight: 1 },
    { variant: { name: "mistral-large-3-searxng", overrides: { search_model: "mistralai/mistral-large-2512",      web_search: "serper" }},       weight: 0 },
  ],
};

const SIMPLE_BOT_WRITER_TEST: ABTest = {
  name: "simple_bot_writer",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "sonnet5",          overrides: { writer_model: "anthropic/claude-sonnet-5"      }}, weight: 50 },
    { variant: { name: "gemini-flash",     overrides: { writer_model: "google/gemini-3-flash-preview" }}, weight: 30 },
    { variant: { name: "fable5",           overrides: { writer_model: "anthropic/claude-fable-5"      }}, weight: 10 },
    { variant: { name: "opus5",            overrides: { writer_model: "anthropic/claude-opus-5"       }}, weight: 10 },
    { variant: { name: "sonnet",           overrides: { writer_model: "anthropic/claude-sonnet-4.6"   }}, weight: 0 },
    { variant: { name: "deepseek-v4flash", overrides: { writer_model: "deepseek/deepseek-v4-flash"    }}, weight: 0 },
  ],
};

// Text verifier model only; media verification always uses Gemini.
const SIMPLE_BOT_VERIFIER_TEST: ABTest = {
  name: "simple_bot_verifier",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "gemini-flash",     overrides: { verifier_model: "google/gemini-3-flash-preview" }}, weight: 50 },
    { variant: { name: "deepseek-v4flash", overrides: { verifier_model: "deepseek/deepseek-v4-flash"    }}, weight: 0  },
  ],
};

// Compare prompt instructions with timing context; never enable both together.
// The off arm was retired on 2026-08-23; it remains available for explicit comparison.
const TIMING_TREATMENT_TEST: ABTest = {
  name: "timing_treatment",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off",         overrides: { time_travel_prompt: false, timing_context: false } }, weight: 0 },
    { variant: { name: "instruction", overrides: { time_travel_prompt: true,  timing_context: false } }, weight: 50 },
    { variant: { name: "context",     overrides: { time_travel_prompt: false, timing_context: true  } }, weight: 50 },
  ],
};

// Does a final writer abstention check reduce not-helpful notes?
const WRITER_LAST_CHECK_TEST: ABTest = {
  name: "writer_last_check",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { writer_last_check: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { writer_last_check: true  } }, weight: 50 },
  ],
};

// Common Notes forces on for extracted claims; ordinary X runs use off.
const SIMPLE_BOT_CLAIM_TEST: ABTest = {
  name: "search_claim",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_claim: false } }, weight: 100 },
    { variant: { name: "on",  overrides: { search_claim: true  } }, weight: 0   },
  ],
};

// Concede-then-correct wording, only for enrolled curated topics.
// Must run after MISINFO_TOPIC_TEST, whose config field supplies the prerequisite.
const MISINFO_CONCEDE_SHAPE_TEST: ABTest = {
  name: "misinfo_concede_shape",
  prerequisites: { botId: "simple-bot", misinfo_topic: CONCEDE_SHAPE_TOPIC_IDS },
  variants: [
    { variant: { name: "off", overrides: { concede_shape: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { concede_shape: true  } }, weight: 50 },
  ],
};

// Blocked-topic gate before the prefilter; off is the holdout.
const TOPIC_FILTER_TEST: ABTest = {
  name: "topic_filter",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { topic_filter: false } }, weight: 33 },
    { variant: { name: "on",  overrides: { topic_filter: true  } }, weight: 67 },
  ],
};

// Closed on deepseek (2026-08-06). Common Notes and discard audits still need off.
const NOTE_PREFILTER_TEST: ABTest = {
  name: "note_prefilter",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off",      overrides: { note_prefilter: false } }, weight: 0 },
    { variant: { name: "deepseek", overrides: { note_prefilter: true  } }, weight: 100 },
  ],
};

// Allow media URLs to be verified using automated media analysis.
const VERIFIER_MEDIA_SOURCES_TEST: ABTest = {
  name: "verifier_media_sources",
  variants: [
    { variant: { name: "reject", overrides: { verifier_accepts_media_sources: false } }, weight: 0 },
    { variant: { name: "accept", overrides: { verifier_accepts_media_sources: true  } }, weight: 100 },
  ],
};

// Closed on claim-based (2026-09-02). Common Notes still forces classic.
const VERIFIER_CLAIM_BASED_TEST: ABTest = {
  name: "verifier_claim_based",
  defaultVariant: "classic",
  variants: [
    { variant: { name: "classic",     overrides: { verifier_claim_based: false } }, weight: 0 },
    { variant: { name: "claim-based", overrides: { verifier_claim_based: true  } }, weight: 100 },
  ],
};

// Closed on off for X (2026-09-02). Common Notes forces on for public source quotes.
const VERIFIER_CITATIONS_TEST: ABTest = {
  name: "verifier_citations",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { verifier_citations: false } }, weight: 100 },
    { variant: { name: "on",  overrides: { verifier_citations: true  } }, weight: 0 },
  ],
};

// Provenance, not an experiment: processPosts forces the fetched feed tier.
// Missing historical picks mean small, the original feed.
const FEED_SIZE_TEST: ABTest = {
  name: "feed_size",
  defaultVariant: "small",
  variants: [
    { variant: { name: "small", overrides: {} }, weight: 100 },
    { variant: { name: "large", overrides: {} }, weight: 0 },
    { variant: { name: "xl",    overrides: {} }, weight: 0 },
    { variant: { name: "xxl",   overrides: {} }, weight: 0 },
  ],
};

// Provenance: processPosts forces yes and misinfo_topic for curated-topic posts.
const MISINFO_MONITORING_TEST: ABTest = {
  name: "misinfo_monitoring",
  defaultVariant: "no",
  variants: [
    { variant: { name: "no",  overrides: {} }, weight: 100 },
    { variant: { name: "yes", overrides: {} }, weight: 0 },
  ],
};

// Mirror the forced topic into config so concede-shape can gate on the topic roster.
const MISINFO_TOPIC_TEST: ABTest = {
  name: "misinfo_topic",
  defaultVariant: "none",
  variants: [
    { variant: { name: "none", overrides: {} }, weight: 100 },
    ...MISINFO_TOPIC_IDS.map((id) => ({ variant: { name: id, overrides: { misinfo_topic: id } }, weight: 0 })),
  ],
};

// Provenance: Pangram candidates record yes; ordinary runs record no.
const PANGRAM_MONITORING_TEST: ABTest = {
  name: "pangram_monitoring",
  defaultVariant: "no",
  variants: [
    { variant: { name: "no",  overrides: {} }, weight: 100 },
    { variant: { name: "yes", overrides: {} }, weight: 0 },
  ],
};

// Standalone Pangram wording experiment; sampled in generatePangramCandidates only.
// Do not add to AB_TESTS: ordinary notes receive neither treatment.
export const PANGRAM_NOTE_TEST: ABTest = {
  name: "pangram_note",
  variants: [
    { variant: { name: "plain",      overrides: {} }, weight: 50 },
    { variant: { name: "fp_context", overrides: {} }, weight: 50 },
  ],
};

// Fixed submission cutoff -3. Missing historical picks used the original cutoff 0.
const EVAL_SUBMIT_THRESHOLD_TEST: ABTest = {
  name: "eval_submit_threshold",
  defaultVariant: "0",
  variants: [
    { variant: { name: "-3", overrides: { eval_submit_threshold: -3 } }, weight: 100 },
    { variant: { name: "0",  overrides: { eval_submit_threshold: 0  } }, weight: 0   },
    { variant: { name: "-6", overrides: { eval_submit_threshold: -6 } }, weight: 0   },
  ],
};

// Closed on on_with_unhelpful (2026-09-02). Missing historical picks had no author context.
const AUTHOR_HISTORY_TEST: ABTest = {
  name: "author_history",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { author_history: false } }, weight: 0 },
    { variant: { name: "on",  overrides: { author_history: true  } }, weight: 0 },
    {
      variant: {
        name: "on_with_unhelpful",
        overrides: { author_history: true, author_history_unhelpful: true },
      },
      weight: 100,
    },
  ],
};

// Chosen once per batch in runPipeline and forced onto each post; names identify scorers.
export const RANKING_POLICY_TEST: ABTest = {
  name: "ranking_policy",
  defaultVariant: "velocity_only",
  variants: [
    { variant: { name: "velocity_only",   overrides: { ranking_policy: "velocity_only"   } }, weight: 50 },
    { variant: { name: "flags_then_eval", overrides: { ranking_policy: "flags_then_eval" } }, weight: 50 },
  ],
};

export const AB_TESTS: ABTest[] = [
  BOT_TEST,
  SIMPLE_BOT_SEARCH_TEST,
  SIMPLE_BOT_WRITER_TEST,
  SIMPLE_BOT_VERIFIER_TEST,
  TIMING_TREATMENT_TEST,
  WRITER_LAST_CHECK_TEST,
  SIMPLE_BOT_CLAIM_TEST,
  TOPIC_FILTER_TEST,
  NOTE_PREFILTER_TEST,
  VERIFIER_MEDIA_SOURCES_TEST,
  VERIFIER_CLAIM_BASED_TEST,
  VERIFIER_CITATIONS_TEST,
  EVAL_SUBMIT_THRESHOLD_TEST,
  FEED_SIZE_TEST,
  MISINFO_MONITORING_TEST,
  MISINFO_TOPIC_TEST,
  MISINFO_CONCEDE_SHAPE_TEST,
  PANGRAM_MONITORING_TEST,
  AUTHOR_HISTORY_TEST,
  RANKING_POLICY_TEST,
];
