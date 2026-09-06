/**
 * The runtime half of the A/B test framework.
 *
 * A pipeline run is configured by running every A/B test in the order the tests
 * are declared. Each test lists its variants together with a sampling weight.
 * The first test picks the bot. Every later test overlays more BotConfig fields
 * on top, and it only runs when its `prerequisites` match the config built so
 * far.
 *
 * The variant chosen for each test is recorded in a `picks` dictionary. That
 * dictionary is stored in `pipeline_runs.ab_test_picks`, a column migration 038
 * added.
 *
 * The tests themselves live in `abTestsData.ts`, which is safe to import in a
 * browser. This file holds the helpers that sample, force and resolve picks.
 * They live apart because they need `node:async_hooks` and DEFAULT_CONFIG.
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
 * Pick the variant name for a single test on its own, honouring a forced pick.
 * This is for callers outside the bot pipeline that need one A/B decision and
 * no bot config at all. The Pangram pre-pass uses it to choose the note wording
 * for each candidate.
 */
export function pickVariantName(test: ABTest): string {
  const forced = getForcedPicks()[test.name];
  return forced ? findVariantByName(test, forced).name : sampleVariantByWeight(test.variants).name;
}

/**
 * Run all A/B tests in order, starting from a fresh DEFAULT_CONFIG. Returns the
 * resolved config. Also returns a picks dictionary that maps each test name to
 * the variant name that test chose, for every test that fired.
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
    // A retired test keeps its declaration with every weight set to zero. That
    // way a forced pick from a historical run still resolves to a real variant.
    // Live sampling skips the test.
    if (!forcedName && test.variants.every((v) => v.weight <= 0)) continue;
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

// --- Forced picks, used for replay and debugging ---

const forcedPicksStorage = new AsyncLocalStorage<Record<string, string>>();

export function withForcedPicks<T>(picks: Record<string, string>, fn: () => T): T {
  if ("time_travel_prompt" in picks) {
    throw new Error('A/B test "time_travel_prompt" is retired; use "timing_treatment" instead.');
  }
  if ("simple_bot_anti_pedantic" in picks) {
    throw new Error('A/B test "simple_bot_anti_pedantic" is retired; its winning prompt is always enabled.');
  }
  return forcedPicksStorage.run(picks, fn);
}

export function getForcedPicks(): Record<string, string> {
  return forcedPicksStorage.getStore() ?? {};
}

// --- Reading picks in consumers ---

/**
 * Return a new picks dictionary with every test's `defaultVariant` filled in
 * wherever a key is missing. Call this at the boundary where raw rows enter a
 * consumer. Everything downstream then sees the same shape no matter when the
 * row was written.
 *
 * This function does not evaluate prerequisites. A caller is expected to narrow
 * the rows to the relevant population first, for example to rows whose bot is
 * `simple-bot`, before it reads a prereq-gated pick such as `simple_bot_search`.
 * That is why a prereq-gated test should leave `defaultVariant` unset.
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

// --- Helpers exposed for telemetry and tooling ---

/**
 * Return how likely the bot test is to pick each bot, as a percentage. Reports
 * and dashboards use this to show the live split between the bots.
 */
export function getBotProbabilities(): { id: string; probability: number }[] {
  const total = BOT_TEST.variants.reduce((s, v) => s + v.weight, 0);
  return BOT_TEST.variants.map(({ variant, weight }) => ({
    id: variant.name,
    probability: total > 0 ? (weight / total) * 100 : 0,
  }));
}
