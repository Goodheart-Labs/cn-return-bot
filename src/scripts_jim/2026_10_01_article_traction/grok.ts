/**
 * Calls Grok through xAI's Responses API with the x_search tool switched on, and
 * saves the raw response under data/. xAI reports what it billed in
 * `usage.cost_in_usd_ticks`, where one tick is 1e-10 dollars.
 */
import "dotenv/config";
import { writeFileSync } from "fs";

const USD_PER_TICK = 1e-10;
const DAY_MS = 86_400_000;

export type GrokRun = { parsed: any; costUsd: number; searchCalls: number; citations: string[] };

export async function grokXSearch(label: string, prompt: string, lookbackDays: number, model = "grok-4.7"): Promise<GrokRun> {
  const fromDate = new Date(Date.now() - lookbackDays * DAY_MS).toISOString().slice(0, 10);
  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: prompt, tools: [{ type: "x_search", from_date: fromDate }] }),
  });
  const body = await response.json();
  writeFileSync(`${import.meta.dir}/data/${label}.json`, JSON.stringify(body, null, 2));
  if (!response.ok) throw new Error(`xAI ${response.status} for ${label}: ${JSON.stringify(body).slice(0, 300)}`);
  const message = body.output.find((o: any) => o.type === "message");
  const text: string = message.content.map((c: any) => c.text).join("");
  const citations: string[] = message.content.flatMap((c: any) => (c.annotations ?? []).map((a: any) => a.url));
  return {
    parsed: JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)),
    costUsd: body.usage.cost_in_usd_ticks * USD_PER_TICK,
    searchCalls: body.output.filter((o: any) => o.type !== "message" && o.type !== "reasoning").length,
    citations,
  };
}
