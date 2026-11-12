/* GOO-688: finds which field of the Agents SDK's request OpenRouter refuses.
 * It captures the harness's first request, then sends it again with one
 * top-level field or tool field removed at a time. max_output_tokens is cut
 * to keep each try cheap. */

import { runJob } from "../../agent-notes/harness";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_TESTING_KEY;
process.env.OPENAI_AGENTS_DISABLE_TRACING = "1";

let captured: any = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  if (!captured && String(url).endsWith("/responses")) captured = JSON.parse(init.body);
  return new Response(JSON.stringify({ error: { message: "captured" } }), { status: 400 });
}) as typeof fetch;
const item = { id: "i", url: "https://example.com/p", title: "T", full_text: "The Eiffel Tower was finished in 1899.", published_at: "2026-11-01", project: { name: "P", slug: "p" } };
await runJob({ kind: "post", item: item as never, asked: { requests: [], onlyThese: false }, picks: {} }, { effort: "low", tier: "default", provider: "openrouter" }).catch(() => {});
globalThis.fetch = realFetch;

const { input, ...rest } = captured;
console.log("top-level fields:", JSON.stringify({ ...rest, tools: rest.tools.map((t: any) => ({ ...t, parameters: t.parameters ? "…" : undefined })) }, null, 1));

async function send(label: string, body: any) {
  const response = await fetch("https://openrouter.ai/api/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, input: [input[0], { role: "user", content: "Reply with OK." }], max_output_tokens: 200, tools: body.tools }),
  });
  const json: any = await response.json();
  console.log(`${label}: ${json.error ? `ERROR ${JSON.stringify(json.error).slice(0, 200)}` : `ok, cached=${json.usage?.input_tokens_details?.cached_tokens}`}`);
}

await send("as the SDK sends it", captured);
for (const key of Object.keys(rest)) {
  const { [key]: _removed, ...without } = captured;
  await send(`without ${key}`, without);
}
for (const [i, tool] of captured.tools.entries()) {
  await send(`without tool ${tool.name ?? tool.type}`, { ...captured, tools: captured.tools.filter((_: unknown, j: number) => j !== i) });
}
