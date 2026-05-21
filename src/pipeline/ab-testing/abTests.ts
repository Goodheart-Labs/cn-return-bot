/**
 * A/B Test Framework
 *
 * A pipeline run is the result of running N A/B tests in declaration order.
 * Each test defines variants and a weight per variant. The first test picks
 * the bot; subsequent tests overlay BotConfig fields conditional on
 * `prerequisites` matching the current partial config.
 *
 * The chosen variant for each test is recorded in a `picks` dictionary that
 * gets persisted to `pipeline_runs.ab_test_picks` (added in migration 038).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { BotConfig, ScoreFilter } from "./botConfig";
import { DEFAULT_CONFIG } from "./botConfig";

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

const BOT_TEST: ABTest = {
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
    { variant: { name: "sonnet46-native",         overrides: { search_model: "anthropic/claude-sonnet-4.6",       web_search: "native" }},        weight: 4 },
    { variant: { name: "haiku45-native",          overrides: { search_model: "anthropic/claude-haiku-4.5",        web_search: "native" }},        weight: 0 },
    { variant: { name: "grok43-native",           overrides: { search_model: "x-ai/grok-4.3",                     web_search: "native_grok" }},   weight: 1 },
    { variant: { name: "gemini3flash-native",     overrides: { search_model: "google/gemini-3-flash-preview",     web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "gemini35flash-native",    overrides: { search_model: "google/gemini-3.5-flash",           web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "gemini3pro-native",       overrides: { search_model: "google/gemini-3-pro-preview",       web_search: "native_gemini" }}, weight: 1 },
    { variant: { name: "sonar-reasoning-pro",     overrides: { search_model: "perplexity/sonar-reasoning-pro",    web_search: "bundled" }},       weight: 2 },
    { variant: { name: "sonar-pro",               overrides: { search_model: "perplexity/sonar-pro",              web_search: "bundled" }},       weight: 0 },
    { variant: { name: "kimi-k26-searxng",        overrides: { search_model: "moonshotai/kimi-k2.6",              web_search: "searxng" }},       weight: 2 },
    { variant: { name: "deepseek-v4pro-searxng",  overrides: { search_model: "deepseek/deepseek-v4-pro",          web_search: "searxng" }},       weight: 0 },
    { variant: { name: "glm5-searxng",            overrides: { search_model: "z-ai/glm-5",                        web_search: "searxng" }},       weight: 1 },
    { variant: { name: "deepseek-v32exp-searxng", overrides: { search_model: "deepseek/deepseek-v3.2-exp",        web_search: "searxng" }},       weight: 0 },
    { variant: { name: "qwen3max-searxng",        overrides: { search_model: "qwen/qwen3-max",                    web_search: "searxng" }},       weight: 0 },
    { variant: { name: "gpt5_4mini-native",       overrides: { search_model: "openai/gpt-5.4-mini",               web_search: "native_openai" }}, weight: 0 },
    { variant: { name: "gpt5-native",             overrides: { search_model: "openai/gpt-5",                      web_search: "native_openai" }}, weight: 0.5 },
    { variant: { name: "mistral-large-3-searxng", overrides: { search_model: "mistralai/mistral-large-2512",      web_search: "searxng" }},       weight: 2 },
  ],
};

const SIMPLE_BOT_WRITER_TEST: ABTest = {
  name: "simple_bot_writer",
  prerequisites: { botId: "simple-bot" },
  variants: [
    { variant: { name: "sonnet",       overrides: { writer_model: "anthropic/claude-sonnet-4.6"   }}, weight: 50 },
    { variant: { name: "gemini-flash", overrides: { writer_model: "google/gemini-3-flash-preview" }}, weight: 50 },
  ],
};

// Verifier is hardcoded to Gemini-flash via DEFAULT_CONFIG.verifier_model.
// Add SIMPLE_BOT_VERIFIER_TEST later when comparing verifiers.

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
  VERIFIER_MEDIA_SOURCES_TEST,
  AGENT_SEARCH_TEST,
  AGENT_PARALLEL_TEST,
  FEED_SIZE_TEST,
];

// --- Sampling ---

function matchesPrerequisites(config: Partial<BotConfig>, prereqs: Prerequisites): boolean {
  return Object.entries(prereqs).every(([k, expected]) => {
    const actual = (config as any)[k];
    return Array.isArray(expected) ? (expected as unknown[]).includes(actual) : actual === expected;
  });
}

function sampleVariantByWeight(
  variants: { variant: ABVariant; weight: number }[],
): ABVariant {
  const total = variants.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) {
    throw new Error("Cannot sample from variants with total weight 0");
  }
  let r = Math.random() * total;
  for (const { variant, weight } of variants) {
    r -= weight;
    if (r <= 0) return variant;
  }
  return variants[variants.length - 1]!.variant;
}

function findVariantByName(test: ABTest, name: string): ABVariant {
  const found = test.variants.find((v) => v.variant.name === name);
  if (!found) {
    const known = test.variants.map((v) => v.variant.name).join(", ");
    throw new Error(`A/B test "${test.name}" has no variant named "${name}". Known: ${known}`);
  }
  return found.variant;
}

/**
 * Run all A/B tests in order against a fresh DEFAULT_CONFIG. Returns the
 * resolved config plus a picks dictionary mapping testName → variantName for
 * every test that fired.
 */
export function runABTests(tests: ABTest[]): {
  config: BotConfig;
  picks: Record<string, string>;
} {
  const config: Partial<BotConfig> = { ...DEFAULT_CONFIG };
  const picks: Record<string, string> = {};
  const forced = getForcedPicks();

  for (const test of tests) {
    if (test.prerequisites && !matchesPrerequisites(config, test.prerequisites)) continue;

    const forcedName = forced[test.name];
    const variant = forcedName
      ? findVariantByName(test, forcedName)
      : sampleVariantByWeight(test.variants);

    picks[test.name] = variant.name;
    Object.assign(config, variant.overrides);
  }

  if (!config.botId) {
    throw new Error("AB_TESTS did not produce a botId — make sure the bot test is first");
  }
  return { config: config as BotConfig, picks };
}

// --- Forced picks (replay / debugging) ---

const forcedPicksStorage = new AsyncLocalStorage<Record<string, string>>();

export function withForcedPicks<T>(picks: Record<string, string>, fn: () => T): T {
  return forcedPicksStorage.run(picks, fn);
}

export function getForcedPicks(): Record<string, string> {
  return forcedPicksStorage.getStore() ?? {};
}

// --- Reading picks (consumers) ---

/**
 * Return a new picks dict with every test's `defaultVariant` filled in for
 * missing keys. Use this at the boundary where raw rows enter a consumer so
 * everything downstream sees a uniform shape regardless of when the row was
 * written.
 *
 * Deliberately does NOT evaluate prerequisites — callers are expected to
 * filter to the relevant population first (e.g. `bot === "simple-bot"`)
 * before reading prereq-gated picks like `simple_bot_search`. Which is why
 * prereq-gated tests should leave `defaultVariant` unset.
 */
export function resolvePicks(
  picks: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = { ...(picks ?? {}) };
  for (const test of AB_TESTS) {
    if (test.defaultVariant !== undefined && !(test.name in out)) {
      out[test.name] = test.defaultVariant;
    }
  }
  return out;
}

// --- Helpers exposed for telemetry / tooling ---

/**
 * Probability-weighted distribution for the bot test, expressed as percent.
 * Used by reports and dashboards (replaces the old getBotProbabilities()
 * derived from BOT_WEIGHTS).
 */
export function getBotProbabilities(): { id: string; probability: number }[] {
  const total = BOT_TEST.variants.reduce((s, v) => s + v.weight, 0);
  return BOT_TEST.variants.map(({ variant, weight }) => ({
    id: variant.name,
    probability: total > 0 ? (weight / total) * 100 : 0,
  }));
}
