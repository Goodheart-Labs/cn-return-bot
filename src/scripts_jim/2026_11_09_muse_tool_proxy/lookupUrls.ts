/**
 * Muse's search results name only a domain, so GPT could not open or cite them.
 * Meta's browser tool has lookup_citation_url, which turns a result into its
 * URL. This probe asks Muse to search once, look up the URL of every result,
 * and paste the search output with each domain replaced by the full URL.
 *
 * It answers two questions. Are the URLs real pages that hold the snippet?
 * And does a lookup cost a search fee? Meta bills $0.0025 per entry in
 * usage.server_tool_use_details.web_search_requests, so the count of those per
 * call is compared with a plain search of the same query.
 *
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_11_09_muse_tool_proxy/lookupUrls.ts
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { LIST_TOOLS_PROMPT, SEARCH_THEN_CITE_PROMPT, SEARCH_THEN_LOOKUP_LIST_PROMPT, SEARCH_THEN_MARKER_PROMPT } from "./prompts";

const MODEL = "meta/muse-spark-1.3-contributor";
const OUT_DIR = path.join(import.meta.dir, "results");
const NATIVE_SEARCH_TOOL = { type: "openrouter:web_search", parameters: { engine: "native" } };
const PAGE_TIMEOUT_MS = 20_000;
/** The words of a snippet that are compared with the page. Fewer words would match by chance, more would cross the snippet's cut. */
const SNIPPET_WORDS_TO_MATCH = 8;

const QUERIES = [
  "Steven Pinker homicide rate Western Europe decline since Middle Ages",
  "California Proposition 50 2025 election results percentage",
];

async function callMuse(prompt: string) {
  const startedAt = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], tools: [NATIVE_SEARCH_TOOL], usage: { include: true } }),
  });
  const body: any = await response.json();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return {
    content: String(body.choices?.[0]?.message?.content ?? ""),
    citedUrls: (body.choices?.[0]?.message?.annotations ?? []).filter((a: any) => a.type === "url_citation").map((a: any) => a.url_citation?.url as string),
    searchRequests: body.usage?.server_tool_use_details?.web_search_requests ?? 0,
    costUsd: body.usage?.cost ?? 0,
    tokenCostUsd: (body.usage?.cost_details?.upstream_inference_prompt_cost ?? 0) + (body.usage?.cost_details?.upstream_inference_completions_cost ?? 0),
    seconds: (Date.now() - startedAt) / 1000,
  };
}

const normalise = (text: string) => text.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").toLowerCase().trim();

/** One search result as Muse pasted it: the marker with its URL, then the snippet lines up to the next result. */
function resultsOf(content: string): { url: string; snippet: string }[] {
  const blocks = content.split(/^L\d+: +\* 【\d+†/m).slice(1);
  return blocks.map((block) => {
    const [header, ...lines] = block.split("\n");
    const url = header.match(/https?:\/\/[^\s†】]+/)?.[0] ?? "";
    const snippet = lines.map((line) => line.replace(/^L\d+: ?/, "")).join(" ").replace(/\s*\.\.\.\s*/g, " ");
    return { url, snippet };
  });
}

/** Whether the page at the URL loads and holds the first words of the snippet. A plain GET only, so pages that block datacenters count as unchecked, not as wrong. */
async function checkResult(result: { url: string; snippet: string }) {
  if (!result.url) return { ...result, status: "no url" as const };
  const isOnlyDomain = new URL(result.url).pathname.length <= 1;
  try {
    const response = await fetch(result.url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" } });
    if (!response.ok) return { ...result, isOnlyDomain, status: `http ${response.status}` as const };
    const page = normalise(await response.text());
    const words = normalise(result.snippet).split(" ").slice(0, SNIPPET_WORDS_TO_MATCH).join(" ");
    return { ...result, isOnlyDomain, status: page.includes(words) ? ("snippet on page" as const) : ("snippet not found" as const) };
  } catch (err) {
    return { ...result, isOnlyDomain, status: `fetch failed: ${(err as Error).name}` as const };
  }
}

/** The URLs Muse wrote out itself, one per "【n】 https://..." line. */
const listedUrls = (content: string) => [...content.matchAll(/^【\d+】\s*(https?:\/\/\S+)/gm)].map((match) => match[1]);

const toolList = process.argv.includes("--with-tool-list") ? await callMuse(LIST_TOOLS_PROMPT) : { content: "(skipped)", searchRequests: 0 };
console.log(`Muse's own tool list (${toolList.searchRequests} searches billed):\n${toolList.content}\n`);

const onlyVariant = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const runs = await Promise.all(QUERIES.flatMap((query) => [
  { variant: "lookup list", prompt: SEARCH_THEN_LOOKUP_LIST_PROMPT(query), urlsOf: (muse: { content: string }) => listedUrls(muse.content) },
  { variant: "cite every result", prompt: SEARCH_THEN_CITE_PROMPT(query), urlsOf: (muse: { citedUrls: string[] }) => muse.citedUrls },
  { variant: "citation marker per result", prompt: SEARCH_THEN_MARKER_PROMPT(query), urlsOf: (muse: { citedUrls: string[] }) => muse.citedUrls },
].filter(({ variant }) => !onlyVariant || variant.startsWith(onlyVariant)).map(async ({ variant, prompt, urlsOf }) => {
  const muse = await callMuse(prompt);
  const snippets = resultsOf(muse.content).map((result) => result.snippet);
  const urls = urlsOf(muse);
  const results = await Promise.all(urls.map((url, i) => checkResult({ url, snippet: snippets[i] ?? "" })));
  return { query, variant, ...muse, resultCount: snippets.length, results };
})));

mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `lookup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify(runs, null, 2));
for (const run of runs) {
  console.log(`${run.variant}: ${run.query}
  ${run.results.length} URLs for ${run.resultCount} results, search requests billed ${run.searchRequests}, cost $${run.costUsd.toFixed(4)} (tokens $${run.tokenCostUsd.toFixed(4)}), ${run.seconds.toFixed(0)} s, ${run.content.length} chars`);
  for (const result of run.results) console.log(`    ${result.status.padEnd(22)} ${"isOnlyDomain" in result && result.isOnlyDomain ? "[domain only] " : ""}${result.url}`);
}
console.log(`Full results in ${outFile}`);
