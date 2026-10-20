/**
 * Runs the branch's gate on every post in items.json, a few times each, and
 * prints how often each post was declined. The production run of these posts
 * used the gate without the memoir rule, so it is the baseline.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { gateAndSplit } from "../../everything/pipeline/gateAndSplit";
import { getCostTracker, withCostTracker } from "../../pipeline/cost-tracking/costTracker";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;

const RUNS_PER_POST = 3;

interface Item {
  id: string;
  title: string;
  full_text: string;
  claims: number;
  checked: number;
  notes: number;
}

const { memoirs, controls } = JSON.parse(readFileSync(new URL("./items.json", import.meta.url), "utf8")) as {
  memoirs: Item[];
  controls: Item[];
};

async function judge(item: Item) {
  return withCostTracker(async () => {
    const verdicts = await Promise.all(
      Array.from({ length: RUNS_PER_POST }, () => gateAndSplit(item.full_text, item.title)),
    );
    const cost = getCostTracker().reduce((sum, entry) => sum + entry.cost, 0);
    const reasons = verdicts.flatMap((v) => (v.kind === "not_checkable" ? [v.reason] : []));
    return { title: item.title, claims: item.claims, checked: item.checked, notes: item.notes, declined: reasons.length, reasons, cost };
  });
}

const results: Record<string, Awaited<ReturnType<typeof judge>>[]> = {};
for (const [name, set] of Object.entries({ memoirs, controls })) {
  results[name] = await Promise.all(set.filter((i) => i.full_text).map(judge));
  console.log(`\n== ${name}: declined / ${RUNS_PER_POST} runs, then claims, checked, notes in prod ==`);
  for (const r of results[name]!) {
    console.log(`${r.declined}/${RUNS_PER_POST}\t${r.claims}\t${r.checked}\t${r.notes}\t${r.title}`);
    for (const reason of new Set(r.reasons)) console.log(`\t\t${reason}`);
  }
}
const totalCost = Object.values(results).flat().reduce((sum, r) => sum + r.cost, 0);
console.log(`\ntotal cost $${totalCost.toFixed(3)}`);
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 2));
