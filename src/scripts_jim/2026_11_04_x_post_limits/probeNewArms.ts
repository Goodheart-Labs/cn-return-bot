/* Replays the research input of a few recent production tweets through the real
 * research step (dispatchSearch) once per live search arm, and prints each
 * answer, how many links its findings cite, and its cost. This checks that
 * OpenRouter accepts each new arm's request shape (GOO-698) and that the model
 * really searches. Uses OPENROUTER_TESTING_KEY.
 *   bun run src/scripts_jim/2026_11_04_x_post_limits/probeNewArms.ts [tweet count] */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { withBotConfig, type BotConfig } from "../../pipeline/ab-testing/botConfig";
import { dispatchSearch } from "../../pipeline/simple-bot/searchDispatch";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";

if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
const DEFAULT_TWEET_COUNT = 1;
const RECENT_RUNS_TO_SCAN = 60;
const tweetCount = Number(process.argv[2] ?? DEFAULT_TWEET_COUNT);
const URL_PATTERN = /https?:\/\/\S+/g;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const searchTest = AB_TESTS.find((t) => t.name === "simple_bot_search")!;
const liveArms = searchTest.variants.filter((v) => v.weight > 0).map((v) => v.variant);

const recent = await db.from("pipeline_runs")
  .select("id, tweet_id, outcome, bot_config, search:logs->note_writer_steps->search")
  .eq("bot_name", "simple-bot").in("outcome", ["submitted", "rejected"])
  .eq("ab_test_picks->>search_cascade", "precheck")
  .gte("created_at", "2026-11-03T00:00:00Z").order("created_at", { ascending: false }).limit(RECENT_RUNS_TO_SCAN);
if (recent.error) throw recent.error;
// The run log stores the research messages as an object keyed "0", "1", and so on.
const inputs = (recent.data as any[])
  .map((r) => ({ ...r, userMessage: r.search?.messages?.["0"]?.userMessage }))
  .filter((r) => r.userMessage)
  .slice(0, tweetCount);

let totalUsd = 0;
for (const run of inputs) {
  console.log(`\n=== tweet ${run.tweet_id} (prod outcome ${run.outcome}, prod search model ${run.bot_config?.search_model})`);
  for (const arm of liveArms) {
    const config = { ...run.bot_config, ...arm.overrides } as BotConfig;
    const startedAt = Date.now();
    try {
      const result = await withBotConfig(config, () => dispatchSearch(run.userMessage, `probe.${arm.name}`));
      const costUsd = result.costEntry.cost ?? 0;
      totalUsd += costUsd;
      const links = new Set(result.findings.match(URL_PATTERN) ?? []).size;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  ${arm.name.padEnd(26)} correction_needed=${String(result.correctionNeeded).padEnd(5)} links=${links} findings=${result.findings.length} chars, ${costUsd.toFixed(3)} USD, ${seconds}s`);
    } catch (err: any) {
      console.log(`  ${arm.name.padEnd(26)} THREW ${String(err?.message ?? err).slice(0, 300)}`);
    }
  }
}
console.log(`\ntotal ${totalUsd.toFixed(2)} USD`);
process.exit(0);
