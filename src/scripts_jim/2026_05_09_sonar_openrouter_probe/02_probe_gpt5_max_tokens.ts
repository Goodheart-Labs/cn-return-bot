/**
 * Probe gpt-5 / gpt-5-mini via OpenRouter to verify the empty-content claim
 * from `2026_05_09_json_parse_failures/02_test_response_format_strictness.ts`.
 *
 * Background: that probe found "empty" content for both models under both
 * `response_format` modes. But production (`searchWithOpenaiNative`) uses
 * `max_tokens=4000` and the web_search_preview tool, and shows essentially
 * no failures — only 1 of 4 gpt-5* runs in the last 14 days failed with
 * empty content. Hypothesis: the earlier probe used `max_tokens=200`,
 * which OpenAI's reasoning models exhaust on internal reasoning before
 * emitting any content.
 *
 * Run from repo root:
 *   bun run src/scripts_jim/2026_05_09_sonar_openrouter_probe/02_probe_gpt5_max_tokens.ts
 */

import "dotenv/config";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

const PROMPT =
  'Respond with strict JSON only matching: { findings: string, correction_needed: boolean }. ' +
  'Set findings to "test" and correction_needed to false.';

async function probe(model: string, max_tokens: number, reasoning?: { effort: string }) {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: PROMPT }],
    max_tokens,
  };
  if (reasoning) body.reasoning = reasoning;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await resp.json() as any;
  const content = data.choices?.[0]?.message?.content ?? "";
  const reasoning_tokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    model,
    max_tokens,
    reasoning_effort: reasoning?.effort ?? "default",
    finish: data.choices?.[0]?.finish_reason,
    content_len: content.length,
    content_first_60: content.slice(0, 60).replace(/\n/g, " "),
    completion_tokens: data.usage?.completion_tokens,
    reasoning_tokens,
  };
}

const cases = [
  // Replicate the original misleading probe
  { model: "openai/gpt-5", max_tokens: 200 },
  { model: "openai/gpt-5-mini", max_tokens: 200 },
  // Production-shape budget
  { model: "openai/gpt-5", max_tokens: 4000 },
  { model: "openai/gpt-5-mini", max_tokens: 4000 },
  // With minimal reasoning effort
  { model: "openai/gpt-5", max_tokens: 4000, reasoning: { effort: "minimal" } },
  { model: "openai/gpt-5-mini", max_tokens: 4000, reasoning: { effort: "minimal" } },
];

const results = [];
for (const c of cases) {
  console.log(`Probing ${c.model} max_tokens=${c.max_tokens} reasoning=${(c as any).reasoning?.effort ?? "default"}`);
  results.push(await probe(c.model, c.max_tokens, (c as any).reasoning));
}

console.log(
  "\n" +
    "model".padEnd(22) +
    "max_tok".padEnd(10) +
    "reasoning".padEnd(12) +
    "finish".padEnd(15) +
    "content".padEnd(10) +
    "completion(reasoning)",
);
console.log("-".repeat(110));
for (const r of results) {
  console.log(
    r.model.padEnd(22) +
      String(r.max_tokens).padEnd(10) +
      r.reasoning_effort.padEnd(12) +
      String(r.finish).padEnd(15) +
      `${r.content_len} chars`.padEnd(10) +
      `${r.completion_tokens} (${r.reasoning_tokens})`,
  );
  if (r.content_len === 0) console.log("    ↳ empty content");
}
