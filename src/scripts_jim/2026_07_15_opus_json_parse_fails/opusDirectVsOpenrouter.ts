import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { llm } from "../../pipeline/llm/llm";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";
import { SEARCH_SYSTEM_PROMPT, SEARCH_PROMPTED_JSON_INSTRUCTION } from "../../pipeline/prompts/simple-bot/searchAgent";

const OR_MODEL = "anthropic/claude-opus-4.8";   // OpenRouter id (dots)
const DIRECT_MODEL = "claude-opus-4-8";          // Anthropic id (dashes)
const REPEATS = 5;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const systemPrompt = `${SEARCH_SYSTEM_PROMPT}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`;

// Real-ish posts to fact-check (varied topics → varied search depth)
const POSTS = [
  "Breaking: The James Webb telescope has officially confirmed the discovery of alien life on exoplanet K2-18b.",
  "Reminder that the 22nd Amendment means a president can only ever serve 8 years total in their lifetime.",
  "The Eiffel Tower was originally built for the city of Barcelona but they rejected it so Paris took it.",
  "New study: drinking 3 cups of coffee a day reduces your risk of death by 50%.",
  "Argentina was moved to Group J of the 2026 World Cup with no proper explanation given by FIFA.",
  "The Great Wall of China is the only man-made structure visible from space with the naked eye.",
];

// Exact prod parse: extractJsonObject -> JSON.parse -> validate shape
function prodParseOk(rawContent: string): { ok: boolean; naiveOk: boolean; err?: string } {
  const naiveOk = (() => { try { const p = JSON.parse(rawContent.replace(/^```json\s*/,"").replace(/```$/,"")); return typeof p==="object"; } catch { return false; } })();
  try {
    const content = extractJsonObject(rawContent ?? "");
    const p = JSON.parse(content) as any;
    const ok = typeof p.findings === "string" && typeof p.correction_needed === "boolean";
    return { ok, naiveOk };
  } catch (e: any) {
    return { ok: false, naiveOk, err: e.message?.slice(0, 80) };
  }
}

async function viaOpenRouter(userMessage: string): Promise<string> {
  const r: any = await llm.create({
    model: OR_MODEL,
    messages: [
      { role: "system", content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] },
      { role: "user", content: userMessage },
    ],
    tools: [{ type: "web_search_20260209", name: "web_search" }],
  } as any);
  return r.choices?.[0]?.message?.content ?? "";
}

async function viaDirect(userMessage: string): Promise<string> {
  const r: any = await anthropic.messages.create({
    model: DIRECT_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 } as any],
  });
  return r.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

type Rec = { provider: string; post: number; rep: number; ok: boolean; naiveOk: boolean; len: number; err?: string; preview: string };
const recs: Rec[] = [];

async function run(provider: string, fn: (m: string) => Promise<string>) {
  for (let p = 0; p < POSTS.length; p++) {
    for (let rep = 0; rep < REPEATS; rep++) {
      try {
        const raw = await fn(POSTS[p]);
        const { ok, naiveOk, err } = prodParseOk(raw);
        recs.push({ provider, post: p, rep, ok, naiveOk, len: raw.length, err, preview: raw.slice(0, 90).replace(/\n/g, " ") });
        if (!ok) console.log(`\n--- ${provider} FAIL post${p} rep${rep} ---\n${raw.slice(0,600)}\n---`);
        process.stdout.write(ok ? "." : "X");
      } catch (e: any) {
        recs.push({ provider, post: p, rep, ok: false, naiveOk: false, len: 0, err: `THROW ${e.status ?? ""} ${e.message?.slice(0,60)}`, preview: "" });
        process.stdout.write("!");
      }
    }
  }
  console.log(` [${provider} done]`);
}

console.log(`Running Opus 4.8: ${POSTS.length} posts x ${REPEATS} reps x 2 providers = ${POSTS.length*REPEATS*2} calls\n`);
await run("openrouter", viaOpenRouter);
await run("direct", viaDirect);

console.log("\n\n=== RESULTS (prod parser: extractJsonObject + JSON.parse) ===");
for (const provider of ["openrouter", "direct"]) {
  const rs = recs.filter(r => r.provider === provider);
  const ok = rs.filter(r => r.ok).length;
  const naive = rs.filter(r => r.naiveOk).length;
  console.log(`\n${provider}: parse OK ${ok}/${rs.length} = ${(100*ok/rs.length).toFixed(1)}%  |  naive-JSON.parse OK ${naive}/${rs.length} = ${(100*naive/rs.length).toFixed(1)}%`);
  for (const r of rs.filter(r => !r.ok)) {
    console.log(`  FAIL post${r.post} rep${r.rep} len=${r.len} err="${r.err}" preview="${r.preview}"`);
  }
}
process.exit(0);
