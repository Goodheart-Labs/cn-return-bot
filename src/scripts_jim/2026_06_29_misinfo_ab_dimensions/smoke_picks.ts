/**
 * Pure-logic smoke check (no DB): runABTests should record the new misinfo
 * dimensions correctly.
 *   - a regular run (no forced picks) -> misinfo_monitoring=no, misinfo_topic=none
 *   - a misinfo run (forced, as processPosts does) -> yes / <topic_id>
 *   - resolvePicks fills the defaults on a historical row that lacks them
 *
 *   bun run src/scripts_jim/2026_06_29_misinfo_ab_dimensions/smoke_picks.ts
 */

import { runABTests, withForcedPicks, resolvePicks } from "../../pipeline/ab-testing/abTests";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";
import { MISINFO_TOPIC_IDS } from "../../pipeline/misinfo-monitoring/topicIds";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok: ${msg}`);
}

// Regular run: defaults sampled (no:100/0, none:100/0).
const regular = runABTests(AB_TESTS).picks;
assert(regular.misinfo_monitoring === "no", `regular misinfo_monitoring=no (got ${regular.misinfo_monitoring})`);
assert(regular.misinfo_topic === "none", `regular misinfo_topic=none (got ${regular.misinfo_topic})`);

// Misinfo run: forced exactly like processPosts does, for every topic id.
for (const topicId of MISINFO_TOPIC_IDS) {
  const picks = withForcedPicks(
    { misinfo_monitoring: "yes", misinfo_topic: topicId },
    () => runABTests(AB_TESTS).picks,
  );
  assert(
    picks.misinfo_monitoring === "yes" && picks.misinfo_topic === topicId,
    `forced topic ${topicId} -> yes/${topicId} (got ${picks.misinfo_monitoring}/${picks.misinfo_topic})`,
  );
}

// Historical row missing the keys resolves to the defaults at read time.
const resolved = resolvePicks({ bot: "simple-bot" });
assert(resolved.misinfo_monitoring === "no", "resolvePicks default misinfo_monitoring=no");
assert(resolved.misinfo_topic === "none", "resolvePicks default misinfo_topic=none");

console.log("\nAll smoke checks passed.");
