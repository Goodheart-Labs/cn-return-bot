/**
 * Experiment 14: ask Grok, once per crowd, for posts that are going viral or went
 * viral recently in that crowd. Grok also reports the engagement numbers it sees
 * and which crowd accounts engaged, so experiment 15 can check both against X's
 * own data. All crowds run in parallel. Prints handles, numbers and domains only.
 */
import { writeFileSync } from "fs";
import { grokXSearch } from "./grok";

const LOOKBACK_DAYS = 2;
const CROWDS: Record<string, string> = {
  forecasting: "forecasting and prediction markets (Metaculus, Manifold, Polymarket, superforecasters)",
  rationalist: "the rationalist community (LessWrong, Astral Codex Ten)",
  ea: "effective altruism",
  xrisk: "AI safety and AI existential risk",
  tpot: "tpot ('this part of twitter', the post-rationalist and vibecamp crowd)",
  progress: "progress studies, abundance and YIMBY",
  us_politics: "US politics, as followed by policy wonks and political commentators",
  uk_politics: "UK politics, as followed by policy wonks and political commentators",
};

const prompt = (crowd: string) => `Find posts on X from the last ${LOOKBACK_DAYS} days that went viral among people in ${crowd}. Viral means many likes, reposts, quotes and replies, especially from people in that crowd.
Return JSON only: {"posts":[{"post_url":string,"author":string,"likes":number,"reposts":number,"quotes":number,"linked_article_url":string|null,"summary":string,"crowd_engagers":[string]}]}, at most 8 posts, most viral first. crowd_engagers are handles of crowd members who quoted, replied to or reposted the post.`;

const results = await Promise.all(
  Object.entries(CROWDS).map(async ([key, crowd]) => {
    const run = await grokXSearch(`14_grok_${key}`, prompt(crowd), LOOKBACK_DAYS);
    return { key, ...run };
  }),
);

writeFileSync(`${import.meta.dir}/data/14_summary.json`, JSON.stringify(results.map(({ key, parsed, costUsd }) => ({ key, costUsd, posts: parsed.posts })), null, 2));
let total = 0;
for (const { key, parsed, costUsd, searchCalls } of results) {
  total += costUsd;
  console.log(`\n${key}: $${costUsd.toFixed(3)}, ${searchCalls} tool calls, ${parsed.posts.length} posts`);
  for (const p of parsed.posts) {
    const domain = p.linked_article_url ? new URL(p.linked_article_url).host : "-";
    console.log(`  @${p.author} claimed likes=${p.likes} rt=${p.reposts} q=${p.quotes} article=${domain} engagers=${p.crowd_engagers.length}`);
  }
}
console.log(`\ntotal $${total.toFixed(2)}`);
