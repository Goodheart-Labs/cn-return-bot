/**
 * Experiment 19: the first dry run of the daily job returned no posts for any
 * topic. Test, on the AI safety topic with grok-4.3, whether the cause is the
 * one-day search window (from_date equal to to_date) or the "fewer posts, or
 * none, is fine" sentence. Prints posts fetched by the searches and posts returned.
 */
import "dotenv/config";
import { writeFileSync } from "fs";

const DAY = "2026-10-01";
const BASE = `Find posts on X from ${DAY} that went viral among Nathan Young's (@NathanpmYoung) crowd, specifically the AI safety community, and that reference or are about an article or blog post.
List at most 5 posts, most liked first.`;
const PERMISSION = " Only list posts that clearly went viral in this community. Fewer posts, or none, is fine.";
const JSON_ONLY = `\nRespond with strict JSON only: {"posts":[{"post_url":string,"likes":number,"article_url":string}]}`;

const VARIANTS = {
  oneDay_withPermission: { prompt: BASE + PERMISSION, tool: { from_date: DAY, to_date: DAY } },
  oneDay_noPermission: { prompt: BASE, tool: { from_date: DAY, to_date: DAY } },
  twoDays_withPermission: { prompt: BASE + PERMISSION, tool: { from_date: DAY, to_date: "2026-10-02" } },
  noDates_withPermission: { prompt: BASE + PERMISSION, tool: {} },
};

await Promise.all(
  Object.entries(VARIANTS).map(async ([label, { prompt, tool }]) => {
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.3", input: prompt + JSON_ONLY, tools: [{ type: "x_search", ...tool }] }),
    });
    const body = await response.json();
    writeFileSync(`${import.meta.dir}/data/19_${label}.json`, JSON.stringify(body, null, 2));
    const text = body.output.find((o: any) => o.type === "message").content.map((c: any) => c.text).join("");
    const posts = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).posts;
    const usage = body.usage.server_side_tool_usage_details;
    console.log(`${label}: ${usage.x_search_calls} searches fetched ${usage.x_posts_fetched} posts, returned ${posts.length}, $${(body.usage.cost_in_usd_ticks * 1e-10).toFixed(3)}`);
  }),
);
