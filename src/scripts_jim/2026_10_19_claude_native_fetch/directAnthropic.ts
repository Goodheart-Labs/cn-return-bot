/**
 * Sends one Ask Opus request straight to Anthropic's Messages API instead of
 * OpenRouter, and prints every content block of the reply with its type. This
 * shows whether a sentence that OpenRouter returns as the reply was a text
 * block Claude wrote between two tool calls, or something else.
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_10_19_claude_native_fetch/directAnthropic.ts
 */
import "dotenv/config";
import { askOpusSetup } from "../../service/intake/passageQuestions";
import { ALL_FEATURES, enabledFeatures } from "../../everything-core/minisiteFeatures";

const { system, tools } = askOpusSetup(enabledFeatures([...ALL_FEATURES]));
const anthropicTools = tools.map((tool: any) => {
  if (tool.type === "function") return { name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters };
  if (tool.type === "openrouter:web_search") return { type: "web_search_20260209", name: "web_search" };
  return tool;
});
const article = { title: "Why transformers won", url: "https://example.com/transformers", article: "The 2017 paper Attention Is All You Need (https://arxiv.org/abs/1706.03762) showed that attention alone could beat recurrent networks. Its big model needed only 12 hours of training on 8 GPUs." };
const ask = { passage: "Its big model needed only 12 hours of training on 8 GPUs.", earlier: [], question: "Is that right? Check the paper's training section itself, not a summary." };

const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({
    model: process.argv[2] ?? "claude-opus-5-5",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: `${system} Today is ${new Date().toISOString().slice(0, 10)}.`,
    messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(article) }, { type: "text", text: JSON.stringify(ask) }] }],
    tools: anthropicTools,
  }),
});
const body: any = await response.json();
console.log(`HTTP ${response.status} stop_reason=${body.stop_reason} usage=${JSON.stringify(body.usage)}`);
if (!response.ok) console.log(JSON.stringify(body).slice(0, 1000));
for (const block of body.content ?? []) {
  const detail = block.type === "text" ? block.text
    : block.type === "thinking" ? block.thinking
    : block.type === "server_tool_use" || block.type === "tool_use" ? JSON.stringify(block.input)
    : JSON.stringify(block).slice(0, 150);
  console.log(`[${block.type}] ${String(detail).replace(/\s+/g, " ").slice(0, 300)}`);
}
