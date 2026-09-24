/**
 * Does Muse Spark have a search and fetch tool of its own that OpenRouter
 * passes through? Sends a handful of small requests to
 * meta/muse-spark-1.3-contributor with OpenRouter's server tools and prints
 * what came back: the answer, the citations, the search count and the cost.
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_09_16_search_harness_research/probeMuseNativeTools.ts
 */
import "dotenv/config";

const MODEL = "meta/muse-spark-1.3-contributor";
const CLAIM = "Measles cases in the United States in 2025 reached the highest level since 1992.";
const URL_TO_READ = "https://www.cdc.gov/measles/data-research/index.html";
const PREVIEW_CHARS = Number(process.env.PREVIEW_CHARS ?? 600);

const ANSWER_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "check",
    strict: true,
    schema: {
      type: "object",
      properties: { findings: { type: "string" }, correction_needed: { type: "boolean" } },
      required: ["findings", "correction_needed"],
      additionalProperties: false,
    },
  },
};

const OUR_FETCH_TOOL = {
  type: "function",
  function: {
    name: "web_fetch",
    description: "Fetch a URL and extract its main content as markdown.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
};

const cases: Array<{ label: string; body: Record<string, unknown> }> = [
  {
    label: "A. openrouter:web_search, engine native",
    body: {
      messages: [{ role: "user", content: `Check this claim with a web search and cite your sources: ${CLAIM}` }],
      tools: [{ type: "openrouter:web_search", parameters: { engine: "native" } }],
    },
  },
  {
    label: "B. openrouter:web_search, engine auto (no engine set)",
    body: {
      messages: [{ role: "user", content: `Check this claim with a web search and cite your sources: ${CLAIM}` }],
      tools: [{ type: "openrouter:web_search" }],
    },
  },
  {
    label: "C. openrouter:web_fetch, engine native",
    body: {
      messages: [{ role: "user", content: `Read ${URL_TO_READ} and quote, word for word, the sentence that gives the total number of measles cases.` }],
      tools: [{ type: "openrouter:web_fetch", parameters: { engine: "native", max_content_tokens: 8000 } }],
    },
  },
  {
    label: "D. native search + our own function tool + strict json_schema (the production shape)",
    body: {
      messages: [
        { role: "system", content: "You fact-check claims. Search the web, then answer as JSON." },
        { role: "user", content: CLAIM },
      ],
      tools: [{ type: "openrouter:web_search", parameters: { engine: "native" } }, OUR_FETCH_TOOL],
      response_format: ANSWER_SCHEMA,
    },
  },
];

async function runCase(label: string, body: Record<string, unknown>) {
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, usage: { include: true }, ...body }),
  });
  const data: any = await response.json();
  console.log(`\n===== ${label}  (HTTP ${response.status}, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (!response.ok) {
    console.log(JSON.stringify(data.error ?? data, null, 1).slice(0, 1500));
    return;
  }
  const message = data.choices?.[0]?.message ?? {};
  const annotations = message.annotations ?? [];
  console.log("model:", data.model, "| provider:", data.provider, "| finish:", data.choices?.[0]?.finish_reason);
  console.log("usage:", JSON.stringify(data.usage));
  console.log("tool_calls:", JSON.stringify(message.tool_calls ?? null).slice(0, 400));
  console.log(`annotations: ${annotations.length}`);
  for (const a of annotations.slice(0, 5)) console.log("  ", JSON.stringify(a).slice(0, 300));
  console.log("content:", String(message.content ?? "").slice(0, PREVIEW_CHARS));
}

const onlyLabels = process.argv.slice(2);
for (const c of cases) {
  if (onlyLabels.length && !onlyLabels.some((l) => c.label.startsWith(l))) continue;
  await runCase(c.label, c.body);
}
