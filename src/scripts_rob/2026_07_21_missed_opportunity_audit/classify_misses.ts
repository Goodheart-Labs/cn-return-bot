/**
 * Sizes the REAL stage-1 leak.
 *
 * run.ts §2 reports that our keyword predicate rejects 77% of "election-ish"
 * ecosystem-noted tweets — but that denominator is contaminated: the broad
 * regex swept in UK by-elections, Nigerian politics, Canadian CPI, NYC mayoral
 * races. Our predicate is CORRECTLY rejecting those. The number that matters
 * is how many rejected tweets are actually about the July 16 speech's subject
 * matter (US election integrity: voter rolls, noncitizen registration, mail-in
 * ballots, voting machines, the SAVE Act, US voter fraud claims).
 *
 * One cheap batched Gemini Flash pass over the misses. Read-only, no DB writes.
 *
 *   bun run src/scripts_rob/2026_07_21_missed_opportunity_audit/classify_misses.ts
 */

import { llm } from "../../pipeline/llm/llm";
import { stripJsonFences } from "../../pipeline/utils/jsonOutput";
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "src/scripts_rob/2026_07_21_missed_opportunity_audit";
const MODEL = "google/gemini-3-flash-preview";
const BATCH = 40;

const SYSTEM = `You classify tweets by SUBJECT MATTER only. You are not judging truth, bias, or whether a note is warranted.

ON TOPIC means the tweet makes or repeats a factual claim about the integrity or administration of UNITED STATES elections. Examples: voter rolls and registration, noncitizens voting or registering, mail-in/absentee ballots, voting machines or tabulators, election fraud in a US election, the SAVE Act / proof-of-citizenship legislation, federal or state election oversight, the security of US voter data.

OFF TOPIC means anything else, including: elections in other countries (UK by-elections, Nigeria, Canada, Colombia, India), US political horse-race or personality content with no election-integrity claim, campaign finance or lobbying, and general partisan commentary.

Return JSON only: { "results": [ { "id": string, "onTopic": boolean } ] }. Include every id you were given.`;

interface Miss { tweetId: string; text: string; note: string }
const audit = JSON.parse(readFileSync(`${DIR}/audit.json`, "utf8")) as {
  recall: { held: number; matched: number; missed: number; misses: Miss[] };
};
const misses = audit.recall.misses;
console.log(`classifying ${misses.length} predicate-rejected tweets in batches of ${BATCH}…`);

const verdict = new Map<string, boolean>();
for (let i = 0; i < misses.length; i += BATCH) {
  const batch = misses.slice(i, i + BATCH);
  const user = batch
    .map((m) => `id: ${m.tweetId}\ntweet: ${m.text.slice(0, 300)}\ncommunity note on it: ${m.note.slice(0, 200)}`)
    .join("\n---\n");
  const response = await llm.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  } as any);
  const content = response.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(stripJsonFences(content)) as { results?: Array<{ id?: string; onTopic?: boolean }> };
    for (const r of parsed.results ?? []) {
      if (typeof r.id === "string") verdict.set(r.id, r.onTopic === true);
    }
  } catch (err) {
    console.warn(`  batch ${i / BATCH} unparseable, skipped:`, err);
  }
  console.log(`  batch ${i / BATCH + 1}: ${verdict.size}/${misses.length} classified`);
}

const onTopic = misses.filter((m) => verdict.get(m.tweetId));
const unclassified = misses.filter((m) => !verdict.has(m.tweetId));
const { held, matched } = audit.recall;

console.log(`\n=== the real stage-1 leak ===`);
console.log(`predicate-rejected tweets classified: ${misses.length - unclassified.length}${unclassified.length ? ` (${unclassified.length} unclassified)` : ""}`);
console.log(`  genuinely ON TOPIC but rejected by stage 1: ${onTopic.length}`);
console.log(`  correctly rejected (other countries / no integrity claim): ${misses.length - unclassified.length - onTopic.length}`);
const realDenominator = matched + onTopic.length;
console.log(`\ntrue recall on the on-topic population: ${matched}/${realDenominator} = ${realDenominator ? ((100 * matched) / realDenominator).toFixed(1) : "–"}%`);
console.log(`(vs the contaminated ${((100 * matched) / held).toFixed(1)}% in run.ts §2)`);

console.log(`\n--- the on-topic tweets our keyword filter never saw ---`);
for (const m of onTopic) {
  console.log(`\n  ${m.tweetId}`);
  console.log(`    POST: ${m.text.slice(0, 200)}`);
  console.log(`    NOTE: ${m.note.slice(0, 160)}`);
}

writeFileSync(`${DIR}/leak.json`, JSON.stringify({
  generated_at: new Date().toISOString(),
  matched_by_stage1: matched,
  on_topic_missed: onTopic.length,
  true_recall_pct: realDenominator ? (100 * matched) / realDenominator : null,
  unclassified: unclassified.length,
  misses_on_topic: onTopic,
}, null, 2));
console.log(`\nwrote ${DIR}/leak.json`);
