/**
 * A/B Test Framework — runtime half.
 *
 * A pipeline run is the result of running N A/B tests in declaration order.
 * Each test defines variants and a weight per variant. The first test picks
 * the bot; subsequent tests overlay BotConfig fields conditional on
 * `prerequisites` matching the current partial config.
 *
 * The chosen variant for each test is recorded in a `picks` dictionary that
 * gets persisted to `pipeline_runs.ab_test_picks` (added in migration 038).
 *
 * The AB_TESTS data lives in `abTestsData.ts` (browser-safe). This file holds
 * the sampling / forcing / resolving helpers that depend on
 * `node:async_hooks` and DEFAULT_CONFIG.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { BotConfig } from "./botConfig";
import { DEFAULT_CONFIG } from "./botConfig";
import {
  AB_TESTS,
  BOT_TEST,
  type ABTest,
  type ABVariant,
  type Prerequisites,
} from "./abTestsData";

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
 * Pick one test's variant name in isolation (honouring a forced pick), for
 * callers outside the bot pipeline that need a single A/B decision — e.g. the
 * Pangram pre-pass choosing its note wording per candidate.
 */
export function pickVariantName(test: ABTest): string {
  const forced = getForcedPicks()[test.name];
  return forced ? findVariantByName(test, forced).name : sampleVariantByWeight(test.variants).name;
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
