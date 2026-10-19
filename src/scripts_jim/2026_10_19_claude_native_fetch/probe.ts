/**
 * Can Claude search the web and then open a whole page inside one OpenRouter
 * request? Sends a few small requests with different pairings of search and
 * fetch tools and prints, for each, the answer, the counted searches and
 * fetches, the prompt tokens and the cost.
 *
 * The question asks for a sentence from the body of a page that a search
 * excerpt is unlikely to contain, so a correct quote means the page was read.
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_10_19_claude_native_fetch/probe.ts [model] [case letters]
 */
import "dotenv/config";

const MODEL = process.argv[2] ?? "anthropic/claude-opus-5.5";
const ONLY = process.argv[3];
const PAGE_TOKEN_CAP = 20_000;

const QUESTION =
  "Find the 2017 paper 'Attention Is All You Need' on arXiv and open its full text (the arXiv HTML or PDF, not the abstract page). " +
  "Quote, word for word, the first sentence of its section 'Why Self-Attention', and give the label dropout rate (epsilon_ls) it used. " +
  "Say which URL you read.";

const ANTHROPIC_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 5 };
const ANTHROPIC_FETCH = { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3, max_content_tokens: PAGE_TOKEN_CAP };
const OPENROUTER_SEARCH = { type: "openrouter:web_search", parameters: { engine: "native" } };
const OPENROUTER_FETCH = { type: "openrouter:web_fetch", parameters: { engine: "native", max_content_tokens: PAGE_TOKEN_CAP } };
const DRAFT_NOTE = {
  type: "function",
  function: {
    name: "draft_note",
    description: "Draft a note for the reader. Only call this when the reader asks for a note.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
};

const cases: Record<string, { label: string; tools: unknown[] }> = {
  A: { label: "OpenRouter search (native) + Anthropic web_fetch", tools: [OPENROUTER_SEARCH, ANTHROPIC_FETCH] },
  B: { label: "Anthropic web_search + Anthropic web_fetch", tools: [ANTHROPIC_SEARCH, ANTHROPIC_FETCH] },
  C: { label: "OpenRouter search (native) + OpenRouter fetch (native)", tools: [OPENROUTER_SEARCH, OPENROUTER_FETCH] },
  D: { label: "Ask Opus shape: draft_note function + OpenRouter search + Anthropic web_fetch", tools: [DRAFT_NOTE, OPENROUTER_SEARCH, ANTHROPIC_FETCH] },
  E: { label: "Ask Opus shape: draft_note function + Anthropic search + Anthropic web_fetch", tools: [DRAFT_NOTE, ANTHROPIC_SEARCH, ANTHROPIC_FETCH] },
  F: { label: "Search only (today's production): Anthropic web_search", tools: [ANTHROPIC_SEARCH] },
};

async function runCase(letter: string) {
  const { label, tools } = cases[letter]!;
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, usage: { include: true }, messages: [{ role: "user", content: QUESTION }], tools }),
  });
  const body: any = await response.json();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n=== ${letter}. ${label} (${MODEL}), HTTP ${response.status}, ${seconds}s`);
  if (!response.ok) {
    console.log(JSON.stringify(body).slice(0, 800));
    return;
  }
  const message = body.choices?.[0]?.message;
  console.log("provider:", body.provider, "| finish:", body.choices?.[0]?.finish_reason);
  console.log("usage:", JSON.stringify(body.usage));
  console.log("annotations:", (message?.annotations ?? []).map((a: any) => a?.url_citation?.url).filter(Boolean).slice(0, 8));
  console.log("tool_calls:", JSON.stringify(message?.tool_calls ?? []).slice(0, 300));
  console.log("answer:", (message?.content ?? "").slice(0, 1200));
}

for (const letter of ONLY ? ONLY.split("") : Object.keys(cases)) await runCase(letter);
