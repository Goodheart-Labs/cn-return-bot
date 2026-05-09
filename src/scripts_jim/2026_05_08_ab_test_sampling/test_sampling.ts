/**
 * Sanity-check the A/B test framework: weights, prerequisites, forced picks.
 *
 * Run: bun run src/scripts_jim/2026_05_08_ab_test_sampling/test_sampling.ts
 */

import { AB_TESTS, runABTests, withForcedPicks, getBotProbabilities } from "../../pipeline/ab-testing/abTests";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("✗", msg);
    process.exit(1);
  }
  console.log("✓", msg);
}

function tally(n: number, fn: () => Record<string, string>): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (let i = 0; i < n; i++) {
    const picks = fn();
    for (const [k, v] of Object.entries(picks)) {
      counts[k] ??= {};
      counts[k]![v] = (counts[k]![v] ?? 0) + 1;
    }
  }
  return counts;
}

function pct(num: number, den: number): number {
  return den > 0 ? (num / den) * 100 : 0;
}

// 1. Default sampling produces sensible distributions.
const N = 5000;
const counts = tally(N, () => runABTests(AB_TESTS).picks);
console.log("\nBot distribution over", N, "runs:");
for (const [bot, c] of Object.entries(counts.bot ?? {}).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${bot.padEnd(28)} ${String(c).padStart(5)}  (${pct(c, N).toFixed(1)}%)`);
}

// Empirical distribution should match the declared BOT_TEST weights within 5pp.
for (const { id, probability } of getBotProbabilities()) {
  if (probability === 0) continue;
  const observed = pct(counts.bot?.[id] ?? 0, N);
  assert(
    Math.abs(observed - probability) < 5,
    `${id} declared ${probability.toFixed(1)}%, observed ${observed.toFixed(1)}% (within 5pp)`,
  );
}

// 2. Forced picks: bot=opus-main → no simple_bot_* keys, no agent_* keys.
const opusMain = withForcedPicks({ bot: "opus-main" }, () => runABTests(AB_TESTS).picks);
assert(opusMain.bot === "opus-main", "forced bot=opus-main applies");
assert(!("simple_bot_search" in opusMain), "opus-main run has no simple_bot_search");
assert(!("simple_bot_writer" in opusMain), "opus-main run has no simple_bot_writer");
assert(!("agent_search" in opusMain), "opus-main run has no agent_search");
assert(!("agent_parallel" in opusMain), "opus-main run has no agent_parallel");

// 3. Forced picks: bot=simple-bot → simple_bot_* keys present, agent_* absent.
const simple = withForcedPicks({ bot: "simple-bot" }, () => runABTests(AB_TESTS).picks);
assert(simple.bot === "simple-bot", "forced bot=simple-bot applies");
assert("simple_bot_search" in simple, "simple-bot run has simple_bot_search");
assert("simple_bot_writer" in simple, "simple-bot run has simple_bot_writer");
assert(!("agent_search" in simple), "simple-bot run has no agent_search");
assert(!("agent_parallel" in simple), "simple-bot run has no agent_parallel");

// 4. Forced picks: bot=agent → agent_* keys present (disjunction in prerequisites works), simple_bot_* absent.
const agent = withForcedPicks({ bot: "agent" }, () => runABTests(AB_TESTS).picks);
assert(agent.bot === "agent", "forced bot=agent applies (despite weight 0)");
assert("agent_search" in agent, "agent run has agent_search");
assert("agent_parallel" in agent, "agent run has agent_parallel");
assert(!("simple_bot_search" in agent), "agent run has no simple_bot_search");

// 5. Forced picks: bot=multi-agent → same.
const multi = withForcedPicks({ bot: "multi-agent" }, () => runABTests(AB_TESTS).picks);
assert("agent_search" in multi, "multi-agent run has agent_search (disjunction matched)");
assert("agent_parallel" in multi, "multi-agent run has agent_parallel");

// 6. Resolved config has the right model when bot=multi-agent.
const multiResult = withForcedPicks({ bot: "multi-agent" }, () => runABTests(AB_TESTS));
assert(multiResult.config.botId === "multi-agent", "multi-agent config has correct botId");
assert(multiResult.config.model === "google/gemini-3-flash-preview", "multi-agent uses gemini-3-flash-preview");
assert(multiResult.config.scoreFilters.length > 0, "multi-agent has scoreFilters");

// 7. Resolved config for simple-bot has expected fields populated.
const simpleResult = withForcedPicks(
  { bot: "simple-bot", simple_bot_search: "sonnet46-native", simple_bot_writer: "sonnet" },
  () => runABTests(AB_TESTS),
);
assert(simpleResult.config.search_model === "anthropic/claude-sonnet-4.6", "simple-bot search_model set");
assert(simpleResult.config.writer_model === "anthropic/claude-sonnet-4.6", "simple-bot writer_model set");
assert(simpleResult.config.verifier_model === "google/gemini-3-flash-preview", "verifier_model defaults to gemini-flash");
assert(simpleResult.config.web_search === "native", "simple-bot web_search=native for sonnet46-native");

// 8. Forcing a variant that doesn't exist throws.
try {
  withForcedPicks({ bot: "nonexistent" }, () => runABTests(AB_TESTS));
  assert(false, "forcing nonexistent variant should throw");
} catch (err: any) {
  assert(err.message.includes("nonexistent"), "throws helpful error for unknown variant name");
}

console.log("\nAll assertions passed.");
