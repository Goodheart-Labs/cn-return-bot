/**
 * Measures the widened trump_election_security predicate before it ships.
 * Read-only.
 *
 * Two things have to be true for the change to be worth making:
 *   RECALL   — it catches the on-topic posts the old predicate provably missed
 *              (the 71 from the 7/21 audit, classified from public Community
 *              Notes data), while still rejecting the off-topic ones it was
 *              right to reject (UK by-elections, Nigeria, Colombia, …).
 *   VOLUME   — the extra stage-1 matches don't blow up stage-2 judge load.
 *              feed_tweets is the real XXL population the pre-pass crawls, so
 *              the added-match rate there is the honest cost estimate.
 *
 * Imports the LIVE predicate so what is measured is what ships; the old one is
 * pinned as a literal below.
 *
 *   bun run src/scripts_rob/2026_07_21_keyword_recall/measure.ts
 */

import { MISINFO_TOPICS } from "../../pipeline/misinfo-monitoring/topics";
import { getSupabaseClient } from "../../api/supabaseClient";
import { fetchAllRows } from "../../api/paging";
import { readFileSync } from "node:fs";

const AUDIT_DIR = "src/scripts_rob/2026_07_21_missed_opportunity_audit";
const NEW = MISINFO_TOPICS.find((t) => t.id === "trump_election_security")!.matches;

/** The predicate as of 0812e9c, pinned verbatim for comparison. */
const OLD = (t: string) =>
  /\b(elections?|voters?|voting|votes?|ballots?)\b/.test(t) &&
  (/(rigged|stolen|\bstole\b|\bsteal\b|fraud|cheat|hacked|compromised|noncitizen|non-citizen|dominion|smartmatic|maduro|venezuela|decertif|declassif|deep state|mail-?in|voter (roll|file|data)|voting machine|dead voter|illegal (vote|ballot)|220 ?million|278,?000|save america act|\bsave act\b|proof of citizenship|election (security|integrity))/.test(t) ||
    /(china|chinese|\bccp\b|people's republic)/.test(t));

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");
const lc = (s: string) => s.toLowerCase();

// ── RECALL / PRECISION against the audit's classified set ────────────────────
interface Miss { tweetId: string; text: string; note: string }
const audit = JSON.parse(readFileSync(`${AUDIT_DIR}/audit.json`, "utf8")) as { recall: { misses: Miss[] } };
const leak = JSON.parse(readFileSync(`${AUDIT_DIR}/leak.json`, "utf8")) as {
  matched_by_stage1: number; misses_on_topic: Miss[];
};
const onTopicIds = new Set(leak.misses_on_topic.map((m) => m.tweetId));
const offTopic = audit.recall.misses.filter((m) => !onTopicIds.has(m.tweetId));

const recovered = leak.misses_on_topic.filter((m) => NEW(lc(m.text)));
const stillMissed = leak.misses_on_topic.filter((m) => !NEW(lc(m.text)));
const falsePositives = offTopic.filter((m) => NEW(lc(m.text)));

console.log(`\n=== RECALL on the tweets the old predicate provably missed ===`);
console.log(`on-topic misses (ecosystem noted them, we never saw them): ${leak.misses_on_topic.length}`);
console.log(`  now caught: ${recovered.length} (${pct(recovered.length, leak.misses_on_topic.length)})`);
console.log(`  still missed: ${stillMissed.length}`);
const oldRecall = leak.matched_by_stage1 / (leak.matched_by_stage1 + leak.misses_on_topic.length);
const newRecall = (leak.matched_by_stage1 + recovered.length) / (leak.matched_by_stage1 + leak.misses_on_topic.length);
console.log(`\ntopic recall: ${(100 * oldRecall).toFixed(1)}% → ${(100 * newRecall).toFixed(1)}%`);

console.log(`\n=== PRECISION guard: off-topic tweets the old predicate correctly rejected ===`);
console.log(`off-topic rejects: ${offTopic.length}`);
console.log(`  newly (wrongly) matched: ${falsePositives.length} (${pct(falsePositives.length, offTopic.length)})`);
for (const f of falsePositives.slice(0, 15)) console.log(`   ! ${f.text.slice(0, 140)}`);

console.log(`\n--- still missed (accepted residual: no lexical hook to key on) ---`);
for (const m of stillMissed.slice(0, 12)) console.log(`   · ${m.text.slice(0, 140)}`);

// ── VOLUME against the real XXL feed population ──────────────────────────────
const feed = await fetchAllRows<{ tweet_id: string; text: string | null }>(
  () => getSupabaseClient().from("feed_tweets").select("tweet_id, text"),
  "tweet_id", { label: "feed_tweets", pageSize: 1000 });
const texts = feed.filter((f) => f.text).map((f) => ({ id: f.tweet_id, t: lc(f.text!) }));

const oldHits = texts.filter((x) => OLD(x.t));
const newHits = texts.filter((x) => NEW(x.t));
const oldIds = new Set(oldHits.map((x) => x.id));
const added = newHits.filter((x) => !oldIds.has(x.id));

console.log(`\n\n=== VOLUME on feed_tweets (${texts.length} real feed posts) ===`);
console.log(`  old predicate: ${oldHits.length} matches (${pct(oldHits.length, texts.length)} of the feed)`);
console.log(`  new predicate: ${newHits.length} matches (${pct(newHits.length, texts.length)})`);
console.log(`  ADDED:         ${added.length} (+${pct(added.length, Math.max(oldHits.length, 1))} relative)`);

console.log(`\n--- a sample of what the widening newly pulls in (judge these by eye) ---`);
for (const a of added.slice(0, 30)) console.log(`\n  ${a.t.replace(/\s+/g, " ").slice(0, 190)}`);

// Which new sub-pattern is doing the pulling? Attribute each added match.
const PROBES: Array<[string, RegExp]> = [
  ["standalone: save america act / save act", /(save america act|\bsave act\b)/],
  ["standalone: 220 million / 278,000", /(220 ?million|278,?000)/],
  ["standalone: dominion voting / smartmatic", /(dominion voting|smartmatic)/],
  ["signal: won the 2020|2024 election", /(won|winning) the 20(20|24) election/],
  ["signal: 250,000-289,999 style figures", /\b2[5-8]\d,?\d{3}\b|\b2[5-8]\d ?thousand\b|quarter[- ](of a )?million/],
  ["signal: illegals voting / illegal aliens registered", /illegals? (are|can|can'?t|cannot|vot|regist)|illegal (aliens?|immigrants?|voters?) [a-z ]{0,20}(vot|regist)/],
  ["signal: birth certificate / driver's license", /birth certificate|driver'?s licen[sc]e/],
  ["term: elected / swing state", /\b(elected|swing states?)\b/],
  ["signal: election monitors / monitoring elections / polling site", /(election (monitors?|observers?)|monitoring elections|polling (site|place))/],
  ["signal: duplicate registration / tabulator / voter id", /(duplicate registration|tabulator|voter id)/],
  ["term: registration(s) / registered to vote / polling", /\b(registrations?|registered to vote|polling)\b/],
  ["'non citizens' written with a space", /non citizens?/],
];
console.log(`\n--- attribution: which new pattern each added match contains ---`);
for (const [label, re] of PROBES) {
  console.log(`  ${String(added.filter((a) => re.test(a.t)).length).padStart(4)}  ${label}`);
}
