/**
 * Does Sonnet fail to answer in valid JSON when it researches with web search?
 *
 * The cascade's X path escalated to Sonnet 5, and in the 2026-10-19 eval two of
 * three samples of one tweet ended as model_output_invalid. An old investigation
 * (2026_07_02_opus_garbled_search) found that Opus 4.8 garbled its answer when a
 * server-side web search tool and a strict json_schema were attached together,
 * and that Sonnet 4.6 did not. This reruns that kind of test on Sonnet 5 and
 * Sonnet 5.5, on two real inputs, and keeps every raw answer.
 *
 * Variants:
 *   prompted     web search and web fetch tools, JSON asked for in the prompt (what production does since the Claude fetch tool was added)
 *   searchonly   web search tool only, JSON asked for in the prompt (production before that)
 *   schema       web search and web fetch tools, strict json_schema response_format
 *   notool       no tool, JSON asked for in the prompt (control)
 *
 *   bun run src/scripts_jim/2026_10_19_sonnet_json_failures/run.ts [samples]
 */
import "dotenv/config";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { llm } from "../../pipeline/llm/llm";
import { SEARCH_PROMPTED_JSON_INSTRUCTION, SEARCH_RESPONSE_FORMAT, SEARCH_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT_CLAIM } from "../../pipeline/prompts/simple-bot/searchAgent";
import { CLAUDE_RESEARCH_FETCH_TOOL, WEB_SEARCH_TOOL } from "../../pipeline/tool-calling/tools";
import { extractJsonObject } from "../../pipeline/utils/jsonOutput";

const DIR = new URL(".", import.meta.url).pathname;
const MODELS = ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5.5"];
const VARIANTS = ["prompted", "searchonly", "schema", "notool"] as const;
const INPUTS: Record<string, { system: string; user: string }> = (() => {
  const inputs = JSON.parse(readFileSync(join(DIR, "inputs.json"), "utf8"));
  return { "x-steam": { system: SEARCH_SYSTEM_PROMPT, user: inputs["x-steam"] }, "cn-berkeley": { system: SEARCH_SYSTEM_PROMPT_CLAIM, user: inputs["cn-berkeley"] } };
})();
const CONCURRENCY = 6;
const REASONING_EFFORT = "medium";

type Verdict = "valid" | "invalid_json" | "empty" | "wrong_shape" | "error";

function classify(content: string): { verdict: Verdict; detail: string } {
  if (!content.trim()) return { verdict: "empty", detail: "" };
  try {
    const parsed = JSON.parse(extractJsonObject(content));
    if (typeof parsed.findings !== "string" || typeof parsed.correction_needed !== "boolean") return { verdict: "wrong_shape", detail: Object.keys(parsed).join(",") };
    return { verdict: "valid", detail: "" };
  } catch (err: any) {
    return { verdict: "invalid_json", detail: err?.message?.slice(0, 120) ?? "" };
  }
}

async function one(model: string, input: string, variant: (typeof VARIANTS)[number], sample: number) {
  const { system, user } = INPUTS[input]!;
  const systemPrompt = variant === "schema" ? system : `${system}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}`;
  const started = Date.now();
  try {
    const response: any = await llm.create({
      model,
      reasoning_effort: REASONING_EFFORT,
      ...(variant === "notool" ? {} : { tools: variant === "searchonly" ? [WEB_SEARCH_TOOL] : [WEB_SEARCH_TOOL, CLAUDE_RESEARCH_FETCH_TOOL] }),
      ...(variant === "schema" ? { response_format: SEARCH_RESPONSE_FORMAT } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: user },
      ],
    } as any);
    const message = response.choices?.[0]?.message;
    const content: string = message?.content ?? "";
    const citations = (message?.annotations ?? []).length;
    const row = {
      model, input, variant, sample,
      ...classify(content),
      finishReason: response.choices?.[0]?.finish_reason ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
      citations,
      searches: response.usage?.server_tool_use?.web_search_requests ?? null,
      fetches: response.usage?.server_tool_use?.web_fetch_requests ?? null,
      usageKeys: Object.keys(response.usage ?? {}).join(","),
      seconds: Math.round((Date.now() - started) / 100) / 10,
      tail: content.slice(-160),
      head: content.slice(0, 160),
    };
    appendFileSync(join(DIR, "results.jsonl"), JSON.stringify({ ...row, content }) + "\n");
    return row;
  } catch (err: any) {
    const row = { model, input, variant, sample, verdict: "error" as Verdict, detail: String(err?.message ?? err).slice(0, 160), finishReason: null, outputTokens: null, citations: 0, searches: null, fetches: null, usageKeys: "", seconds: Math.round((Date.now() - started) / 100) / 10, tail: "", head: "" };
    appendFileSync(join(DIR, "results.jsonl"), JSON.stringify(row) + "\n");
    return row;
  }
}

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const samples = Number(process.argv[2] ?? 6);
  writeFileSync(join(DIR, "results.jsonl"), "");
  const queue = new PQueue({ concurrency: CONCURRENCY });
  const jobs = MODELS.flatMap((m) => Object.keys(INPUTS).flatMap((i) => VARIANTS.flatMap((v) => Array.from({ length: samples }, (_, s) => () => one(m, i, v, s)))));
  const rows = await Promise.all(jobs.map((job) => queue.add(job) as Promise<Awaited<ReturnType<typeof one>>>));
  console.log("model | input | variant | valid / total | modes");
  for (const m of MODELS) for (const i of Object.keys(INPUTS)) for (const v of VARIANTS) {
    const cell = rows.filter((r) => r.model === m && r.input === i && r.variant === v);
    const modes = cell.filter((r) => r.verdict !== "valid").map((r) => `${r.verdict}(${r.finishReason},${r.outputTokens}tok,${r.citations}cit,${r.searches ?? "?"}s/${r.fetches ?? "?"}f)`).join(" ");
    console.log(`${m.replace("anthropic/", "")} | ${i} | ${v} | ${cell.filter((r) => r.verdict === "valid").length}/${cell.length} | ${modes}`);
  }
}

await main();
