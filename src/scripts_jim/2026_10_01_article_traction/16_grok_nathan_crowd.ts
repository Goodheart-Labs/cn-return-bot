/**
 * Experiment 16: Jim's suggestion. One prompt that names Nathan Young's crowd
 * directly instead of one call per crowd. Run on grok-4.7 and on grok-4.3 to
 * compare cost and quality, since experiment 14 cost about $1.80 per call on
 * grok-4.7. Prints handles, numbers and domains only.
 */
import { writeFileSync } from "fs";
import { grokXSearch } from "./grok";

const LOOKBACK_DAYS = 2;
const MODELS = ["grok-4.7", "grok-4.3"];
const PROMPT = `Find posts on X from the last ${LOOKBACK_DAYS} days that went viral among Nathan Young's (@NathanpmYoung) crowd: AI safety, effective altruism, forecasting, rationalists, tpot, progress studies, and US and UK politics. Viral means many likes, reposts, quotes and replies, especially from people in that crowd.
Return JSON only: {"posts":[{"post_url":string,"author":string,"likes":number,"reposts":number,"quotes":number,"linked_article_url":string|null,"summary":string,"crowd_engagers":[string]}]}, at most 15 posts, most viral first. crowd_engagers are handles of crowd members who quoted, replied to or reposted the post.`;

const runs = await Promise.all(MODELS.map(async (model) => ({ model, ...(await grokXSearch(`16_grok_nathan_${model}`, PROMPT, LOOKBACK_DAYS, model)) })));
writeFileSync(`${import.meta.dir}/data/16_summary.json`, JSON.stringify(runs.map(({ model, parsed, costUsd }) => ({ key: model, costUsd, posts: parsed.posts })), null, 2));
for (const { model, parsed, costUsd, searchCalls } of runs) {
  console.log(`\n${model}: $${costUsd.toFixed(3)}, ${searchCalls} tool calls, ${parsed.posts.length} posts`);
  for (const p of parsed.posts) {
    const domain = p.linked_article_url ? new URL(p.linked_article_url).host : "-";
    console.log(`  @${p.author} claimed likes=${p.likes} q=${p.quotes} article=${domain} engagers=${p.crowd_engagers.length}`);
  }
}
