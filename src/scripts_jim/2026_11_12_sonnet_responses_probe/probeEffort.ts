/**
 * The harness's Sonnet runs reported 0 reasoning tokens at reasoning_effort
 * "medium". This asks a question that needs thought, once with
 * reasoning_effort and once with OpenRouter's reasoning object, to see which
 * one makes Sonnet 5.5 think.
 *
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_11_12_sonnet_responses_probe/probeEffort.ts
 */
import "dotenv/config";

const QUESTION = "A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. Then the ball's price doubles and the bat's price halves. What do both cost together now? Answer with one number.";

for (const [name, setting] of [["reasoning_effort", { reasoning_effort: "medium" }], ["reasoning object", { reasoning: { effort: "medium" } }], ["reasoning enabled", { reasoning: { enabled: true } }], ["reasoning budget", { reasoning: { max_tokens: 4000 } }]] as const) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "anthropic/claude-sonnet-5.5", messages: [{ role: "user", content: QUESTION }], provider: { only: ["anthropic"] }, ...setting }),
  });
  const body: any = await response.json();
  console.log(name, "output tokens:", body.usage?.completion_tokens, "reasoning tokens:", body.usage?.completion_tokens_details?.reasoning_tokens, "answer:", JSON.stringify(String(body.choices?.[0]?.message?.content ?? "").slice(0, 60)), "reasoning text:", String(body.choices?.[0]?.message?.reasoning ?? "").length, "chars");
}
