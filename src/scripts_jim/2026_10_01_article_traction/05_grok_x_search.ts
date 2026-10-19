/**
 * Experiment 5: can Grok's x_search tool find articles that are taking off in
 * the crowd? We call xAI's Responses API directly, so the billed cost comes back
 * in `usage.cost_in_usd_ticks` (one tick is 1e-10 dollars).
 *
 * Two variants:
 * - "topic": no account restriction, the crowd described in words.
 * - "handles": restricted to 20 crowd accounts (the tool's maximum).
 */
import "dotenv/config";
import { writeFileSync } from "fs";

const USD_PER_TICK = 1e-10;
const MODEL = "grok-4.3";
const CROWD_HANDLES = [
  "ESYudkowsky", "robbensinger", "ohabryka", "So8res", "slatestarcodex", "Scott_Alexander_", "NathanpmYoung", "peterwildeford",
  "TheZvi", "willmacaskill", "KelseyTuoc", "dwarkesh_sp", "tylercowen", "patrickc", "jasoncrawford", "MaxCRoser",
  "AISafetyMemes", "ilex_ulmus", "Simeon_Cps", "robertwiblin",
];

const PROMPT = `Find links to articles or blog posts (Substack, LessWrong, news sites, X Articles) that were posted on X in the last 48 hours and are getting a lot of engagement among people in forecasting, rationalism, effective altruism, AI safety and x-risk, and progress studies. Engagement among these people counts, such as them quoting, replying to or reposting the post. Return JSON only: {"articles":[{"url":string,"title":string,"post_url":string,"why":string}]}, at most 10.`;

async function run(label: string, tool: Record<string, unknown>) {
  const today = new Date();
  const twoDaysAgo = new Date(today.getTime() - 2 * 86_400_000);
  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: PROMPT,
      tools: [{ type: "x_search", from_date: twoDaysAgo.toISOString().slice(0, 10), ...tool }],
    }),
  });
  const body = await response.json();
  writeFileSync(`${import.meta.dir}/data/05_grok_${label}.json`, JSON.stringify(body, null, 2));
  const text = body.output?.filter((o: any) => o.type === "message").flatMap((o: any) => o.content.map((c: any) => c.text)).join("") ?? "";
  const toolCalls = body.output?.filter((o: any) => o.type?.includes("call")).length ?? 0;
  console.log(`${label}: status ${response.status}, ${toolCalls} tool calls, cost $${((body.usage?.cost_in_usd_ticks ?? 0) * USD_PER_TICK).toFixed(3)}`);
  try {
    const articles = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).articles;
    for (const a of articles) console.log(`  - ${a.url}`);
  } catch {
    console.log(`  unparsed reply of ${text.length} chars`);
  }
}

await run("topic", {});
await run("handles", { allowed_x_handles: CROWD_HANDLES });
