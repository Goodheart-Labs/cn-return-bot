/**
 * Parity check for the free-key gemini routing.
 *
 * Runs the SAME OpenAI-style request (gemini-3-flash, temp 0, reasoning high,
 * json_schema) through both paths:
 *   - OpenRouter            (llm.create — the existing prod path)
 *   - native free key       (tryGeminiFreeChat — the new routing)
 * and diffs the parsed JSON, field order, and the boolean verdict so we can see
 * whether the provider swap changes behavior (FP-rate risk for cheap-bot).
 *
 * Deviation from the "Python for investigations" rule: this must exercise the
 * TS abstractions (adapter + native client + OpenRouter wrapper), so it's TS.
 */
import "dotenv/config";
import { llm } from "../../pipeline/llm/llm";
import { tryGeminiFreeChat } from "../../pipeline/llm/geminiChatAdapter";
import { geminiNativeGenerateFree, isQuotaError } from "../../pipeline/llm/gemini";
import { GEMINI_MODEL } from "../../pipeline/cost-tracking/pricing";

const RUNS_PER_CASE = 3;
// Free tier is RPM-limited; throttle so a 429 doesn't masquerade as a parity diff.
const THROTTLE_MS = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const satireSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "satire_detector",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reasoning: { type: "string", description: "One or two sentences naming the signals, written BEFORE the verdict." },
        is_satire: { type: "boolean", description: "True only when the audience is unmistakably in on the joke." },
      },
      required: ["reasoning", "is_satire"],
      additionalProperties: false,
    },
  },
};

const queriesSchema = {
  type: "json_schema" as const,
  json_schema: {
    name: "cheap_bot_queries",
    strict: true,
    schema: {
      type: "object",
      properties: {
        queries: { type: "array", items: { type: "string" }, description: "2-5 Google search queries, or [] for opinion/joke posts." },
      },
      required: ["queries"],
      additionalProperties: false,
    },
  },
};

interface Case {
  name: string;
  system: string;
  user: string;
  response_format: any;
  verdictKey: string;
}

const CASES: Case[] = [
  {
    name: "satire/clear-joke",
    system: "You are a satire detector. Decide whether the post is overt satire its audience is in on. Reason first, then verdict. Return JSON: {\"reasoning\":\"...\",\"is_satire\":true|false}",
    user: "Post by @TheOnion: \"Scientists Confirm Average American Now Spends 9 Hours A Day Avoiding Eye Contact.\" Comments are all laughing emojis.",
    response_format: satireSchema,
    verdictKey: "is_satire",
  },
  {
    name: "satire/sincere-false",
    system: "You are a satire detector. Decide whether the post is overt satire its audience is in on. Reason first, then verdict. Return JSON: {\"reasoning\":\"...\",\"is_satire\":true|false}",
    user: "Post by @news_account: \"BREAKING: The FDA has officially banned all vaccines as of today.\" Comments are alarmed and sharing it as real news.",
    response_format: satireSchema,
    verdictKey: "is_satire",
  },
  {
    name: "queries/factual-claim",
    system: "You write 2-5 Google search queries that find evidence about the factual claims in a post. If pure opinion/joke, return []. Return JSON: {\"queries\":[...]}",
    user: "Post: \"Charlie Kirk was shot at Utah Valley University in September 2025.\"",
    response_format: queriesSchema,
    verdictKey: "queries",
  },
];

const baseParams = (c: Case) => ({
  model: GEMINI_MODEL,
  messages: [
    { role: "system" as const, content: c.system },
    { role: "user" as const, content: c.user },
  ],
  response_format: c.response_format,
  temperature: 0,
  reasoning_effort: "high" as const,
});

function parse(text: string): { ok: boolean; obj?: any; keys?: string[] } {
  try {
    const obj = JSON.parse(text);
    return { ok: true, obj, keys: Object.keys(obj) };
  } catch {
    return { ok: false };
  }
}

function verdictStr(obj: any, key: string): string {
  const v = obj?.[key];
  return Array.isArray(v) ? `[${v.length}] ${JSON.stringify(v).slice(0, 120)}` : String(v);
}

for (const c of CASES) {
  console.log(`\n================ ${c.name} ================`);
  for (let i = 0; i < RUNS_PER_CASE; i++) {
    const params = baseParams(c);

    const orRes = await llm.create(params as any);
    const orText = orRes.choices?.[0]?.message?.content ?? "";
    const orParsed = parse(orText);

    const nativeRes = await tryGeminiFreeChat(params as any);
    let nativeErr = "";
    if (!nativeRes) {
      // Adapter swallows the error → null. Re-run the native path directly to
      // surface WHY (quota vs real failure), so a 429 isn't read as a diff.
      try {
        await geminiNativeGenerateFree({
          model: GEMINI_MODEL.replace(/^google\//, ""),
          systemInstruction: c.system,
          userTurns: [{ role: "user", text: c.user }],
          responseSchema: undefined,
          jsonOutput: true,
          temperature: 0,
          thinkingLevel: "HIGH",
        });
      } catch (e: any) {
        nativeErr = isQuotaError(e) ? "QUOTA(429)" : `ERR:${e?.message?.slice(0, 120)}`;
      }
    }
    const ntText = nativeRes?.response.choices?.[0]?.message?.content ?? `(null — ${nativeErr || "not routed"})`;
    const ntParsed = parse(ntText);

    const orVerdict = orParsed.ok ? verdictStr(orParsed.obj, c.verdictKey) : "PARSE_FAIL";
    const ntVerdict = ntParsed.ok ? verdictStr(ntParsed.obj, c.verdictKey) : "PARSE_FAIL";
    const orderOk = JSON.stringify(orParsed.keys) === JSON.stringify(ntParsed.keys);
    const agree = orVerdict === ntVerdict;

    console.log(`\n run ${i + 1}:`);
    console.log(`  OpenRouter  json=${orParsed.ok} keys=${JSON.stringify(orParsed.keys)} ${c.verdictKey}=${orVerdict}`);
    console.log(`  native-free json=${ntParsed.ok} keys=${JSON.stringify(ntParsed.keys)} ${c.verdictKey}=${ntVerdict} routed=${!!nativeRes}`);
    console.log(`  field-order-match=${orderOk}  verdict-agree=${agree}`);
    if (!agree) {
      console.log(`    OR reasoning: ${String(orParsed.obj?.reasoning ?? "").slice(0, 160)}`);
      console.log(`    NT reasoning: ${String(ntParsed.obj?.reasoning ?? "").slice(0, 160)}`);
    }
    await sleep(THROTTLE_MS);
  }
}
