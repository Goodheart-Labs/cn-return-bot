/**
 * Pure-data half of the A/B test framework. The runtime helpers
 * (`runABTests`, `withForcedPicks`, `resolvePicks`, …) live in
 * `abTests.ts` because they pull in `node:async_hooks`. This file is
 * browser-safe — only `import type` references to BotConfig — so the
 * dashboards can pull `AB_TESTS` in directly to derive slot/variant
 * declaration order.
 */

import type { BotConfig } from "./botConfig";

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

export const BOT_TEST: ABTest = {
  name: "bot",
  variants: [
    { variant: { name: "simple-bot",  overrides: { botId: "simple-bot" }}, weight: 100 },
    { variant: { name: "cheap-bot", overrides: {
      botId: "cheap-bot",
      model: "deepseek/deepseek-v4-flash",
      search_model: "deepseek/deepseek-v4-flash",
      writer_model: "deepseek/deepseek-v4-flash",
      note_needed_judge: true,
      // gemini-3-flash judge: big_eval val swap from deepseek-v4-flash roughly
      // halved the hard-FP rate (35%→14%) while gaining coverage (57%→68% PASS).
      note_judge_model: "google/gemini-3-flash-preview",
      verifier_model: "deepseek/deepseek-v4-flash",
      // Source verifier runs Gemini media analysis on TikTok / Instagram /
      // YouTube / image URLs and treats the analysis as the source's content.
      // Text-LLM verifier stays on DeepSeek; only the media-description sub-
      // system uses Gemini (since DeepSeek has no vision).
      verifier_accepts_media_sources: true,
      web_search: "searxng",
      // Enable test-time reasoning on deepseek-v4-flash. Cheap, and improves
      // the judge's "is this dispute substantive" classification + the writer's
      // "find a dispute or return nothing" decision-making.
      reasoning_effort: "high",
    }}, weight: 0 },
  ],
};

// Variants for simple-bot ship at the existing 100% sonnet46-native split.
// Other archs land variant-by-variant in commits 4-7 with non-zero weights.
const SIMPLE_BOT_SEARCH_TEST: ABTest = {
  name: "simple_bot_search",
  prerequisites: { botId: "simple-bot" },
  variants: [
    // Non-uniform weights: sonnet46-native, opus48-native and grok43-native each
    // carry weight 5 as the primary arm; the rest carry smaller exploratory
    // weights, with the weaker/redundant variants pinned to 0 (still declared so
    // their historical picks resolve).
    { variant: { name: "sonnet46-native",         overrides: { search_model: "anthropic/claude-sonnet-4.6",       web_search: "native" }},        weight: 5 },
    { variant: { name: "opus48-native",           overrides: { search_model: "anthropic/claude-opus-4.8",         web_search: "native" }},        weight: 5 },
    { variant: { name: "haiku45-native",          overrides: { search_model: "anthropic/claude-haiku-4.5",        web_search: "native" }},        weight: 0 },
    { variant: { name: "grok43-native",           overrides: { search_model: "x-ai/grok-4.3",                     web_search: "native_grok" }},   weight: 5 },
    { variant: { name: "gemini3flash-native",     overrides: { search_model: "google/gemini-3-flash-preview",     web_search: "native_gemini" }}, weight: 0 },
    { variant: { name: "gemini35flash-native",    overrides: { search_model: "google/gemini-3.5-flash",           web_search: "native_gemini" }}, weight: 2 },
    { variant: { name: "gemini31pro-native",      overrides: { search_model: "google/gemini-3.1-pro-preview",      web_search: "native_gemini" }}, weight: 2 },
    { variant: { name: "sonar-reasoning-pro",     overrides: { search_model: "perplexity/sonar-reasoning-pro",    web_search: "bundled" }},       weight: 0 },
    { variant: { name: "sonar-pro",               overrides: { search_model: "perplexity/sonar-pro",              web_search: "bundled" }},       weight: 0 },
    { variant: { name: "kimi-k26-searxng",        overrides: { search_model: "moonshotai/kimi-k2.6",              web_search: "searxng" }},       weight: 0 },
    { variant: { name: "deepseek-v4pro-searxng",  overrides: { search_model: "deepseek/deepseek-v4-pro",          web_search: "searxng" }},       weight: 0 },
    { variant: { name: "deepseek-v4flash-searxng",overrides: { search_model: "deepseek/deepseek-v4-flash",        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "glm5-searxng",            overrides: { search_model: "z-ai/glm-5",                        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "deepseek-v32exp-searxng", overrides: { search_model: "deepseek/deepseek-v3.2-exp",        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "qwen3max-searxng",        overrides: { search_model: "qwen/qwen3-max",                    web_search: "searxng" }},       weight: 0 },
    { variant: { name: "gpt5_4mini-native",       overrides: { search_model: "openai/gpt-5.4-mini",               web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5-native",             overrides: { search_model: "openai/gpt-5",                      web_search: "native_openai" }}, weight: 1 },
    { variant: { name: "mistral-large-3-searxng", overrides: { search_model: "mistralai/mistral-large-2512",      web_search: "searxng" }},       weight: 0 },
  ],
};

const SIMPLE_BOT_WRITER_TEST: ABTest = {
  name: "simple_bot_writer",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "sonnet",           overrides: { writer_model: "anthropic/claude-sonnet-4.6"   }}, weight: 0 },
    { variant: { name: "gemini-flash",     overrides: { writer_model: "google/gemini-3-flash-preview" }}, weight: 100 },
    { variant: { name: "deepseek-v4flash", overrides: { writer_model: "deepseek/deepseek-v4-flash"    }}, weight: 0 },
  ],
};

// Source checker (text-LLM source verifier) model for simple-bot. Baseline is
// Gemini-flash (DEFAULT_CONFIG.verifier_model); this 50/50 split trials
// deepseek-v4-flash as the verifier. Media analysis is unaffected — it always
// runs on Gemini regardless of verifier_model. Prereq-gated to simple-bot, so
// no defaultVariant.
const SIMPLE_BOT_VERIFIER_TEST: ABTest = {
  name: "simple_bot_verifier",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "gemini-flash",     overrides: { verifier_model: "google/gemini-3-flash-preview" }}, weight: 50 },
    { variant: { name: "deepseek-v4flash", overrides: { verifier_model: "deepseek/deepseek-v4-flash"    }}, weight: 0  },
    { variant: { name: "opus48",           overrides: { verifier_model: "anthropic/claude-opus-4.8"     }}, weight: 0  },
  ],
};

// Swap simple-bot's search + writer system prompts for maximally-terse variants
// (the shared verifier / user-message prompts are untouched). Tests whether the
// long criteria lists pull their weight. Live 50/50 on simple-bot. Prereq-gated
// to simple-bot, so no defaultVariant.
const SIMPLE_BOT_PROMPTS_TEST: ABTest = {
  name: "simple_bot_prompts",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "detailed", overrides: { simple_prompts: false } }, weight: 50 },
    { variant: { name: "simple",   overrides: { simple_prompts: true  } }, weight: 50 },
  ],
};

// Append an instruction to simple-bot's SEARCH prompt to prefer, for political
// posts, sources associated with the post author's own political side — the
// bridging bet that a correction cited to the author's own trusted outlets is
// more likely to be rated helpful. Scaled down to a 10% holdout on simple-bot
// (was 50/50) — "off" is now the primary arm. Prereq-gated to simple-bot, so no
// defaultVariant.
const SIMPLE_BOT_POLITICAL_SOURCES_TEST: ABTest = {
  name: "simple_bot_political_sources",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_political_sources: false } }, weight: 90 },
    { variant: { name: "on",  overrides: { search_political_sources: true  } }, weight: 10 },
  ],
};

// Swap simple-bot's SEARCH prompt for an "anti-pedantic" variant that only
// flags a correction when the post's main claim / argument is wrong, never a
// minor side error — the bet that pedantic nitpicks hurt the helpful/FP rate.
// Composes with SIMPLE_BOT_PROMPTS_TEST (the terse base has its own variant).
// Live 50/50 on simple-bot. Prereq-gated to simple-bot, so no defaultVariant.
const SIMPLE_BOT_ANTI_PEDANTIC_TEST: ABTest = {
  name: "simple_bot_anti_pedantic",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_anti_pedantic: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { search_anti_pedantic: true  } }, weight: 50 },
  ],
};

// Tell the search prompt a note is probably needed — a prior used when re-checking
// hand-picked claims so the agent investigates instead of defaulting to "no
// correction". Off in prod (weight 0 on); forced via --picks. Prereq-gated to
// simple-bot, so no defaultVariant.
const SIMPLE_BOT_NOTE_LIKELY_TEST: ABTest = {
  name: "search_note_likely",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_note_likely: false } }, weight: 100 },
    { variant: { name: "on",  overrides: { search_note_likely: true  } }, weight: 0   },
  ],
};

// Append a few-shot block of real, well-performing notes (all simple, direct,
// and short) to simple-bot's writer system prompt, testing whether concrete
// examples pull the writer toward that "simple and nice" style vs the
// principles-only prompt. Holds the writer model + every other step constant,
// so the prompt is the only variable. Live 50/50 on simple-bot — watch the
// helpful/FP rate of the `on` arm. Prereq-gated to simple-bot, so no
// defaultVariant.
const SIMPLE_BOT_WRITER_EXAMPLES_TEST: ABTest = {
  name: "simple_bot_writer_examples",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "off", overrides: { writer_examples: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { writer_examples: true  } }, weight: 50 },
  ],
};

// Cheap deepseek-v4-flash note-needed prefilter that runs BEFORE the bot and
// skips it when no note is warranted (recorded as rejected / prefilter_no_note).
// This is what makes the large feed affordable. Mostly-on, with a 20% "off"
// holdout so we can measure in prod how often the bot writes a note on posts the
// prefilter would have cut (the real false-negative rate). defaultVariant "off"
// so historical rows (no pick) resolve to no-prefilter via resolvePicks.
const NOTE_PREFILTER_TEST: ABTest = {
  name: "note_prefilter",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off",      overrides: { note_prefilter: false } }, weight: 20 },
    { variant: { name: "deepseek", overrides: { note_prefilter: true  } }, weight: 80 },
  ],
};

// Model used for cheap-bot's note-needed judge (the primary FP guard). The
// BOT_TEST cheap-bot variant sets the baseline (gemini-3-flash); this test
// swaps just the judge model, holding writer/verifier/search constant so a
// cached writer-output replay isolates the judge model as the only variable.
// gemini3flash won the big_eval val A/B (lowest hard-FP at 14%, 68% PASS) over
// deepseek-v4flash (35% FP), deepseek-v4pro (16% FP, over-rejects good notes),
// and sonnet46 (18% FP). Prereq-gated to cheap-bot, so no defaultVariant
// (resolvePicks can't evaluate prereqs; a missing pick already falls back to
// BOT_TEST's note_judge_model).
const CHEAP_BOT_JUDGE_MODEL_TEST: ABTest = {
  name: "cheap_bot_judge_model",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "gemini3flash",     overrides: { note_judge_model: "google/gemini-3-flash-preview" } }, weight: 100 },
    { variant: { name: "deepseek-v4flash", overrides: { note_judge_model: "deepseek/deepseek-v4-flash"   } }, weight: 0 },
    { variant: { name: "deepseek-v4pro",   overrides: { note_judge_model: "deepseek/deepseek-v4-pro"     } }, weight: 0 },
    { variant: { name: "sonnet46",         overrides: { note_judge_model: "anthropic/claude-sonnet-4.6"  } }, weight: 0 },
  ],
};

// Run gemini-3-flash for exactly the two steps where it most improved the
// big_eval val — the search analyzer (evidence synthesis) and the note-needed
// judge (the FP guard) — and keep deepseek-v4-flash everywhere else (query
// writer, satire detector, writer, verifier). note_judge_model is already
// gemini via CHEAP_BOT_JUDGE_MODEL_TEST, so this test routes the analyzer to
// gemini (search_analyzer_model) and pins the satire detector back to deepseek
// (satire_model) — which otherwise shares note_judge_model. Placed after
// CHEAP_BOT_JUDGE_MODEL_TEST so its overrides win. Prereq-gated to cheap-bot,
// so no defaultVariant.
const CHEAP_BOT_GEMINI_STEPS_TEST: ABTest = {
  name: "cheap_bot_gemini_steps",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "deepseek-baseline", overrides: {} }, weight: 0 },
    { variant: { name: "gemini-analyzer-judge", overrides: {
      search_analyzer_model: "google/gemini-3-flash-preview",
      satire_model: "deepseek/deepseek-v4-flash",
    } }, weight: 100 },
  ],
};

// Replace the query-writer → SearXNG → analyzer chain with a single Gemini
// native-search call (googleSearch): Gemini issues its own queries and returns
// a findings brief directly. The writer/judge/verifier gates are unchanged. The
// cheap-bot orchestrator branches on web_search="native_gemini"; search_model
// is set to gemini here because the native variant's search call must hit
// Gemini. Prereq-gated to cheap-bot, so no defaultVariant.
const CHEAP_BOT_NATIVE_SEARCH_TEST: ABTest = {
  name: "cheap_bot_native_search",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "searxng", overrides: {} }, weight: 50 },
    { variant: { name: "native-gemini", overrides: {
      web_search: "native_gemini",
      search_model: "google/gemini-3-flash-preview",
    } }, weight: 50 },
  ],
};

const VERIFIER_MEDIA_SOURCES_TEST: ABTest = {
  name: "verifier_media_sources",
  variants: [
    { variant: { name: "reject", overrides: { verifier_accepts_media_sources: false } }, weight: 0 },
    { variant: { name: "accept", overrides: { verifier_accepts_media_sources: true  } }, weight: 100 },
  ],
};

// Two-call claim-based source verifier vs the single-call accept/reject flow.
// claim-based: extract the note's distinct claims, then map each to its
// supporting cited sources; submit the good sources iff every claim has one.
// Not prereq-gated (verifySources runs in both simple- and cheap-bot), so
// defaultVariant "classic" lets historical rows resolve to the old flow.
const VERIFIER_CLAIM_BASED_TEST: ABTest = {
  name: "verifier_claim_based",
  defaultVariant: "classic",
  variants: [
    { variant: { name: "classic",     overrides: { verifier_claim_based: false } }, weight: 50 },
    { variant: { name: "claim-based", overrides: { verifier_claim_based: true  } }, weight: 50 },
  ],
};

// Reason-then-judge source verifier: per source, gather verbatim snippets + a
// plain-language explanation of how each supports/refutes the note, THEN judge
// good/bad. Orthogonal to verifier_claim_based — both flows have a citations
// variant, so the two tests mix freely. Not prereq-gated (verifySources runs in
// both bots), so defaultVariant "off" lets historical rows resolve.
const VERIFIER_CITATIONS_TEST: ABTest = {
  name: "verifier_citations",
  defaultVariant: "off",
  variants: [
    { variant: { name: "off", overrides: { verifier_citations: false } }, weight: 50 },
    { variant: { name: "on",  overrides: { verifier_citations: true  } }, weight: 50 },
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

const SEARCH_ANALYZER_TEST: ABTest = {
  name: "search_analyzer",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "off", overrides: { search_analyzer: false } }, weight: 0 },
    { variant: { name: "on",  overrides: { search_analyzer: true  } }, weight: 100 },
  ],
};

// Pre-search satire gate: reads post + comments + profile (no note), early-exits
// before the query writer when the post is overt satire the audience is in on.
// High-precision; the note-needed judge keeps a lighter satire backstop.
const SATIRE_DETECTOR_TEST: ABTest = {
  name: "satire_detector",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "off", overrides: { satire_detector: false } }, weight: 0 },
    { variant: { name: "on",  overrides: { satire_detector: true  } }, weight: 100 },
  ],
};

// Pin every cheap-bot LLM call to temperature 0. At the model's default
// temperature the judge/verifier are so non-deterministic that ~58% of eval
// rows flipped run-to-run, swamping any prompt-change signal. Prereq-gated to
// cheap-bot so the other bots keep their default sampling.
const CHEAP_BOT_TEMPERATURE_TEST: ABTest = {
  name: "cheap_bot_temperature",
  prerequisites: { botId: "cheap-bot" },
  variants: [
    { variant: { name: "default", overrides: {} },               weight: 0 },
    { variant: { name: "zero",    overrides: { temperature: 0 } }, weight: 100 },
  ],
};

// Eval-score cutoff for submission. The X eval gate keeps a note iff
// `claim_opinion_score >= eval_submit_threshold`. Baseline is 0 (the historical
// hardcoded cutoff) at 50%; the five lower cutoffs each get 10% to measure how
// many extra notes submit — and how they perform — as we relax the gate. Not
// prereq-gated (the eval gate runs for every bot in processTweet), so
// defaultVariant "0" lets pre-existing rows resolve to the old cutoff.
const EVAL_SUBMIT_THRESHOLD_TEST: ABTest = {
  name: "eval_submit_threshold",
  defaultVariant: "0",
  variants: [
    { variant: { name: "0",    overrides: { eval_submit_threshold: 0    } }, weight: 50 },
    { variant: { name: "-0.5", overrides: { eval_submit_threshold: -0.5 } }, weight: 10 },
    { variant: { name: "-1.0", overrides: { eval_submit_threshold: -1.0 } }, weight: 10 },
    { variant: { name: "-1.5", overrides: { eval_submit_threshold: -1.5 } }, weight: 10 },
    { variant: { name: "-2.0", overrides: { eval_submit_threshold: -2.0 } }, weight: 10 },
    { variant: { name: "-2.5", overrides: { eval_submit_threshold: -2.5 } }, weight: 10 },
  ],
};

export const AB_TESTS: ABTest[] = [
  BOT_TEST,
  SIMPLE_BOT_SEARCH_TEST,
  SIMPLE_BOT_WRITER_TEST,
  SIMPLE_BOT_VERIFIER_TEST,
  SIMPLE_BOT_PROMPTS_TEST,
  SIMPLE_BOT_ANTI_PEDANTIC_TEST,
  SIMPLE_BOT_NOTE_LIKELY_TEST,
  SIMPLE_BOT_WRITER_EXAMPLES_TEST,
  SIMPLE_BOT_POLITICAL_SOURCES_TEST,
  NOTE_PREFILTER_TEST,
  CHEAP_BOT_JUDGE_MODEL_TEST,
  CHEAP_BOT_GEMINI_STEPS_TEST,
  CHEAP_BOT_NATIVE_SEARCH_TEST,
  VERIFIER_MEDIA_SOURCES_TEST,
  VERIFIER_CLAIM_BASED_TEST,
  VERIFIER_CITATIONS_TEST,
  SEARCH_ANALYZER_TEST,
  SATIRE_DETECTOR_TEST,
  CHEAP_BOT_TEMPERATURE_TEST,
  FEED_SIZE_TEST,
  EVAL_SUBMIT_THRESHOLD_TEST,
];
