/**
 * Verify the misinfo reference-doc injection + new LLM-input logging end-to-end
 * through the REAL cheap-bot search analyzer.
 *
 * The full pre-pass can't easily re-trigger on the dump (sightings are used up /
 * processed posts enter cooldown), so this exercises the production code path
 * directly: set the monitoring ALS context for a topic, call runSearchAnalyzer,
 * and print what landed in the tweet log. logLlmInput runs BEFORE the LLM call,
 * so the captured input is printed even if the call itself hits the billing cap.
 *
 * Run: bun run src/scripts_jim/2026_05_29_xxl_feed_monitor/verifyAnalyzerInjection.ts
 */

import { withForcedPicks, runABTests } from "../../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";
import { withBotConfig } from "../../pipeline/ab-testing/botConfig";
import { createTweetLog, withTweetLog, nestDotKeys } from "../../pipeline/utils/tweetLog";
import { withCostTracker } from "../../pipeline/cost-tracking/costTracker";
import { withMonitoringContext } from "../../pipeline/misinfo-monitoring/monitoringContext";
import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { runSearchAnalyzer } from "../../pipeline/cheap-bot/searchAnalyzer";

const TOPIC = MISINFO_TOPICS.find((t) => t.id === "ai_water")!;

const SAMPLE_POST = `## Post by @someone
"They're building a massive AI data center in Florida and it'll drink millions of gallons of our drinking water. Every ChatGPT prompt uses a bottle of water."`;

const SAMPLE_FINDINGS = `## Query: florida ai data center water use
- Tallahassee Democrat: "Local officials debate water permit for new data center" (https://tallahassee.example/water)
- USA Today: "How much water do data centers really use?" (https://usatoday.example/datacenters)`;

async function main() {
  const log = createTweetLog();

  await withForcedPicks({ bot: "cheap-bot" }, () => {
    const { config } = runABTests(AB_TESTS);
    return withBotConfig(config, () =>
      withCostTracker(() =>
        withTweetLog(log, () =>
          withMonitoringContext(
            { topicId: TOPIC.id, topicTitle: TOPIC.title, documentUrl: TOPIC.documentUrl, document: TOPIC.document },
            async () => {
              try {
                await runSearchAnalyzer(SAMPLE_POST, SAMPLE_FINDINGS);
              } catch (err: any) {
                console.warn(`[verify] analyzer LLM call failed (input still logged): ${err?.message ?? err}`);
              }
            },
          ),
        ),
      ),
    );
  });

  const nested = nestDotKeys(Object.fromEntries(log)) as any;
  const injected = nested?.note_writer_steps?.search_analyzer?.referenceInjected;
  const loggedInput = nested?.llm_inputs?.cheapBot?.searchAnalyzer as string | undefined;

  console.log("\n=== referenceInjected marker ===");
  console.log(JSON.stringify(injected, null, 2));

  console.log("\n=== llm_inputs.cheapBot.searchAnalyzer (logged input) ===");
  console.log(loggedInput ?? "(MISSING — input was not logged!)");

  console.log("\n=== assertions ===");
  const hasUrl = !!loggedInput?.includes(TOPIC.documentUrl);
  const hasRefHeader = !!loggedInput?.includes("## Reference document");
  console.log(`reference Source URL present: ${hasUrl ? "PASS" : "FAIL"} (${TOPIC.documentUrl})`);
  console.log(`reference block header present: ${hasRefHeader ? "PASS" : "FAIL"}`);
  console.log(`referenceInjected marker set: ${injected && injected !== false ? "PASS" : "FAIL"}`);
}

main();
