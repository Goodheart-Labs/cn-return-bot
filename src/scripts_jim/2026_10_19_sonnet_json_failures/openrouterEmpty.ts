/**
 * Saves the complete OpenRouter response of every call, so that the empty ones
 * can be read in full: finish reason, native finish reason, tool calls, reasoning
 * and usage. Sonnet 5.5, web search and fetch, JSON asked for in the prompt.
 *
 *   bun run src/scripts_jim/2026_10_19_sonnet_json_failures/openrouterEmpty.ts [samples]
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import PQueue from "p-queue";
import { llm } from "../../pipeline/llm/llm";
import { SEARCH_PROMPTED_JSON_INSTRUCTION, SEARCH_SYSTEM_PROMPT_CLAIM } from "../../pipeline/prompts/simple-bot/searchAgent";
import { WEB_SEARCH_TOOL, webFetchNativeTool } from "../../pipeline/tool-calling/tools";

/** The fetch tool that PR #599 gave every Claude and PR #607 took away again. The experiment still needs it. */
const CLAUDE_RESEARCH_FETCH_TOOL = webFetchNativeTool({ maxUses: 5, maxContentTokens: 20000 });

const DIR = new URL(".", import.meta.url).pathname;
const inputs = JSON.parse(readFileSync(join(DIR, "inputs.json"), "utf8"));

async function main() {
  if (process.env.OPENROUTER_TESTING_KEY) process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
  const samples = Number(process.argv[2] ?? 10);
  const queue = new PQueue({ concurrency: 5 });
  const responses = await Promise.all(
    Array.from({ length: samples }, (_, sample) =>
      queue.add(async () => {
        try {
          const response: any = await llm.create({
            model: "anthropic/claude-sonnet-5.5",
            reasoning_effort: "medium",
            tools: [WEB_SEARCH_TOOL, CLAUDE_RESEARCH_FETCH_TOOL],
            messages: [
              { role: "system", content: `${SEARCH_SYSTEM_PROMPT_CLAIM}\n\n${SEARCH_PROMPTED_JSON_INSTRUCTION}` },
              { role: "user", content: inputs["cn-berkeley"] },
            ],
          } as any);
          return { sample, response };
        } catch (err: any) {
          return { sample, error: String(err?.message ?? err) };
        }
      }),
    ),
  );
  writeFileSync(join(DIR, "openrouter-full.json"), JSON.stringify(responses, null, 1));
  for (const r of responses as any[]) {
    const choice = r?.response?.choices?.[0];
    console.log(r.sample, r.error ?? `finish=${choice?.finish_reason} native=${choice?.native_finish_reason} content=${(choice?.message?.content ?? "").length}chars toolCalls=${(choice?.message?.tool_calls ?? []).length} reasoning=${(choice?.message?.reasoning ?? "").length}chars`);
  }
}

await main();
