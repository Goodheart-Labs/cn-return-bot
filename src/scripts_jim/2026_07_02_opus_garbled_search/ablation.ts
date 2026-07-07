/**
 * Ablation: isolate WHAT makes opus48-native garble. Replicates the exact
 * llm.create call from searchWithAnthropicNative and toggles one factor at a
 * time, capturing the FULL raw content + finish_reason + tool_calls (which
 * dispatchSearch throws away).
 *
 * Variants:
 *   A prod         — WEB_SEARCH_TOOL + strict json_schema   (the shipped config)
 *   B tool-only    — WEB_SEARCH_TOOL, no response_format, prompted-JSON instruction
 *   C schema-only  — no tool,          strict json_schema
 *   D sonnet-prod  — sonnet-4.6 with WEB_SEARCH_TOOL + json_schema (is it Opus-specific?)
 *
 * Usage: bun run src/scripts_jim/2026_07_02_opus_garbled_search/ablation.ts [runsPerVariant]
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { llm } from "../../pipeline/llm/llm";
import { WEB_SEARCH_TOOL } from "../../pipeline/tool-calling/tools";
import {
  SEARCH_SYSTEM_PROMPT,
  SEARCH_RESPONSE_FORMAT,
  SEARCH_PROMPTED_JSON_INSTRUCTION,
} from "../../pipeline/prompts/simple-bot/searchAgent";

const K = Number(process.argv[2] ?? 6);
const userMessage = readFileSync(join(import.meta.dir, "userMessage.txt"), "utf8");

const OPUS = "anthropic/claude-opus-4.8";
const SONNET = "anthropic/claude-sonnet-4.6";

const SALAD = /[<>\/]{4,}|<invoke\b|<\/?antml|<\/?[a-z][a-z0-9]*>|test_>|\bdquote\b/i;

interface Variant {
  key: string;
  model: string;
  tool: boolean;
  schema: boolean;
}
const VARIANTS: Variant[] = [
  { key: "A_prod_tool+schema", model: OPUS, tool: true, schema: true },
  { key: "B_tool_prompted-json", model: OPUS, tool: true, schema: false },
  { key: "C_schema_no-tool", model: OPUS, tool: false, schema: true },
  { key: "D_sonnet_tool+schema", model: SONNET, tool: true, schema: true },
];

function buildParams(v: Variant) {
  const system = v.schema
    ? SEARCH_SYSTEM_PROMPT
    : `${SEARCH_SYSTEM_PROMPT}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`;
  return {
    model: v.model,
    messages: [
      { role: "system", content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] },
      { role: "user", content: userMessage },
    ],
    ...(v.tool ? { tools: [WEB_SEARCH_TOOL] } : {}),
    ...(v.schema ? { response_format: SEARCH_RESPONSE_FORMAT } : {}),
  } as any;
}

function judge(content: string) {
  const salad = SALAD.test(content);
  let parses = false;
  try { JSON.parse(content); parses = true; } catch { /* not JSON */ }
  const clean = parses && !salad && content.length > 250;
  return { salad, parses, clean };
}

const rows: any[] = [];

for (const v of VARIANTS) {
  console.log(`\n===== ${v.key}  (model=${v.model}, tool=${v.tool}, schema=${v.schema}) =====`);
  const runs = await Promise.all(
    Array.from({ length: K }, async (_, i) => {
      const start = Date.now();
      try {
        const resp: any = await llm.create(buildParams(v));
        const choice = resp?.choices?.[0];
        const content: string = choice?.message?.content ?? "";
        const j = judge(content);
        return {
          variant: v.key, i, ok: true, ms: Date.now() - start,
          finish_reason: choice?.finish_reason ?? "?",
          hasToolCalls: Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0,
          len: content.length, ...j, content,
        };
      } catch (err: any) {
        return { variant: v.key, i, ok: false, ms: Date.now() - start, error: String(err?.message ?? err) };
      }
    }),
  );
  for (const r of runs) rows.push(r);
  const clean = runs.filter((r) => r.ok && r.clean).length;
  const salad = runs.filter((r) => r.ok && r.salad).length;
  const errs = runs.filter((r) => !r.ok).length;
  console.log(`  clean=${clean}/${K}  salad=${salad}  hardError=${errs}`);
  for (const r of runs) {
    if (r.ok && !r.clean) console.log(`    #${r.i} finish=${r.finish_reason} len=${r.len} salad=${r.salad} parses=${r.parses} :: ${JSON.stringify(r.content).slice(0, 260)}`);
    if (!r.ok) console.log(`    #${r.i} ERROR :: ${r.error?.slice(0, 260)}`);
  }
}

const outPath = join(import.meta.dir, "ablation.jsonl");
writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log("\n===== ABLATION SUMMARY =====");
for (const v of VARIANTS) {
  const rs = rows.filter((r) => r.variant === v.key);
  const clean = rs.filter((r) => r.ok && r.clean).length;
  console.log(`${v.key.padEnd(24)} clean ${clean}/${rs.length}`);
}
console.log(`raw saved to: ${outPath}`);
