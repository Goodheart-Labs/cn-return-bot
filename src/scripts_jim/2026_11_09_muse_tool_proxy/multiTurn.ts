/**
 * Jim's design: GPT must search before it opens a page, and every GPT agent
 * has one Muse conversation in the background. GPT's search is the first turn
 * of that conversation. Its open_page call names a result of an earlier
 * search, and Muse opens that result in a later turn of the same conversation.
 * The header of an opened page carries the full URL that the search result
 * lacks.
 *
 * Through OpenRouter, a later turn carries only the text Muse pasted, not
 * Meta's search state. So this probe checks whether Muse can still open a
 * result by its number in a later turn, and whether a find in page works on it
 * in the turn after that. As a control, it also asks a fresh request with no
 * conversation to open a result by the search page's id alone.
 *
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_11_09_muse_tool_proxy/multiTurn.ts
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { SEARCH_PROMPT } from "./prompts";

const MODEL = "meta/muse-spark-1.3-contributor";
const OUT_DIR = path.join(import.meta.dir, "results");
const NATIVE_SEARCH_TOOL = { type: "openrouter:web_search", parameters: { engine: "native" } };
const PAGE_TIMEOUT_MS = 20_000;
/** The words of a snippet compared with the opened page. */
const SNIPPET_WORDS_TO_MATCH = 6;

const OPEN_RESULT_PROMPT = (resultId: number) => `Open result 【${resultId}】 of that search with your browser tool.

Paste what your tool showed you, word for word: first the header line with the page's id, title and full URL in brackets, then the "viewing lines" line, then every numbered line. If you could not open it, say only "COULD NOT OPEN" and why. Do not search again. Do not summarise, judge or add anything of your own.`;

const FIND_PROMPT = (pattern: string) => `In the page you just opened, use your find tool to find every place that contains this exact text:

${pattern}

Paste what the find tool showed you, word for word with the line numbers. If the text is not on the page, say only "NO MATCH". Do not search again. Do not summarise, judge or add anything of your own.`;

const FRESH_OPEN_PROMPT = (searchPageId: string, resultId: number) => `Open result 【${resultId}】 of the search results page with id ${searchPageId} with your browser tool.

Paste what your tool showed you, word for word: first the header line with the page's id, title and full URL in brackets, then the "viewing lines" line, then every numbered line. If you could not open it, say only "COULD NOT OPEN" and why. Do not search. Do not summarise, judge or add anything of your own.`;

/** The workaround: one request that repeats the search and opens the result, so Meta still holds the search page. */
const SEARCH_AND_OPEN_PROMPT = (query: string, resultId: number) => `Run exactly one web search with this query, and no other query:

${query}

Then open result 【${resultId}】 of that search with your browser tool. Paste only what the open showed you, word for word: first the header line with the page's id, title and full URL in brackets, then the "viewing lines" line, then every numbered line. Do not paste the search results. If you could not open it, say only "COULD NOT OPEN" and why. Do not summarise, judge or add anything of your own.`;

type Message = { role: "user" | "assistant"; content: string };

async function callMuse(messages: Message[]) {
  const startedAt = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools: [NATIVE_SEARCH_TOOL], usage: { include: true } }),
  });
  const body: any = await response.json();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return {
    content: String(body.choices?.[0]?.message?.content ?? ""),
    browserActions: body.usage?.server_tool_use_details?.web_search_requests ?? 0,
    costUsd: body.usage?.cost ?? 0,
    seconds: (Date.now() - startedAt) / 1000,
  };
}

const normalise = (text: string) => text.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").toLowerCase().trim();

/** The domain and the snippet of one result in Muse's pasted search page. */
function searchResult(searchOutput: string, resultId: number) {
  const marker = new RegExp(`^L\\d+: +\\* 【${resultId}†[^†]*†([^】]+)】`, "m");
  const match = searchOutput.match(marker);
  if (!match || match.index === undefined) return null;
  const rest = searchOutput.slice(match.index + match[0].length).split(/^L\d+: +\* 【/m)[0];
  const snippet = rest.split("\n").map((line) => line.replace(/^L\d+: ?/, "")).join(" ").replace(/\s*\.\.\.\s*/g, " ");
  return { domain: match[1], snippet };
}

/** The URL in the header of an opened page: "[id] Title (https://...)". */
const headerUrl = (openOutput: string) => openOutput.match(/^\[\d+\] .*\((https?:\/\/[^)\s]+)\)\s*$/m)?.[1] ?? null;

/** Whether a plain GET of the URL finds the snippet's first words, so the URL really is the result's page. */
async function snippetOnPage(url: string, snippet: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" } });
    if (!response.ok) return `http ${response.status}`;
    return normalise(await response.text()).includes(normalise(snippet).split(" ").slice(0, SNIPPET_WORDS_TO_MATCH).join(" ")) ? "snippet on page" : "snippet not found";
  } catch (err) {
    return `fetch failed: ${(err as Error).name}`;
  }
}

/** A phrase from the snippet to look for with find in page: words 2 to 5, away from the snippet's cut edges. */
const findPattern = (snippet: string) => snippet.split(/\s+/).filter(Boolean).slice(2, 6).join(" ");

async function conversation(query: string, resultId: number) {
  const search = await callMuse([{ role: "user", content: SEARCH_PROMPT(query) }]);
  const result = searchResult(search.content, resultId);
  if (!result) return { query, resultId, error: "result not in the pasted search page", search };
  const history: Message[] = [{ role: "user", content: SEARCH_PROMPT(query) }, { role: "assistant", content: search.content }];
  const skipTurns = process.argv.includes("--search-and-open");
  const skipped = { content: "(skipped)", browserActions: 0, costUsd: 0, seconds: 0 };
  const open = skipTurns ? skipped : await callMuse([...history, { role: "user", content: OPEN_RESULT_PROMPT(resultId) }]);
  const url = headerUrl(open.content);
  const pattern = findPattern(result.snippet);
  const find = skipTurns ? skipped : await callMuse([...history, { role: "user", content: OPEN_RESULT_PROMPT(resultId) }, { role: "assistant", content: open.content }, { role: "user", content: FIND_PROMPT(pattern) }]);
  const searchPageId = search.content.match(/^\[(\d+)\]/m)?.[1] ?? "";
  const fresh = process.argv.includes("--search-and-open")
    ? await callMuse([{ role: "user", content: SEARCH_AND_OPEN_PROMPT(query, resultId) }])
    : await callMuse([{ role: "user", content: FRESH_OPEN_PROMPT(searchPageId, resultId) }]);
  return {
    query, resultId, domain: result.domain, url, check: url ? await snippetOnPage(url, result.snippet) : "no header",
    freshUrl: headerUrl(fresh.content), freshCheck: headerUrl(fresh.content) ? await snippetOnPage(headerUrl(fresh.content)!, result.snippet) : "no header", pattern,
    search, open, find, fresh,
  };
}

const CASES: [string, number][] = [
  ["Steven Pinker homicide rate Western Europe decline since Middle Ages", 1],
  ["Steven Pinker homicide rate Western Europe decline since Middle Ages", 3],
  ["California Proposition 50 2025 election results percentage", 0],
  ["California Proposition 50 2025 election results percentage", 2],
];

const runs = await Promise.all(CASES.map(([query, resultId]) => conversation(query, resultId)));
mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `multiturn-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify(runs, null, 2));
let total = 0;
for (const run of runs) {
  if ("error" in run) { console.log(`${run.query} result ${run.resultId}: ${run.error}`); total += run.search.costUsd; continue; }
  total += run.search.costUsd + run.open.costUsd + run.find.costUsd + run.fresh.costUsd;
  console.log(`${run.query}, result ${run.resultId} (${run.domain})
  open in turn 2: ${run.url ?? "NO URL"} -> ${run.check}; ${run.open.browserActions} actions billed, $${run.open.costUsd.toFixed(4)}, ${run.open.seconds.toFixed(0)} s
    ${run.open.content.slice(0, 200).replace(/\n/g, " | ")}
  find "${run.pattern}" in turn 3: ${run.find.browserActions} actions billed, $${run.find.costUsd.toFixed(4)}
    ${run.find.content.slice(0, 200).replace(/\n/g, " | ")}
  fresh request: ${run.freshUrl ?? "NO URL"} -> ${run.freshCheck}; ${run.fresh.browserActions} actions billed, $${run.fresh.costUsd.toFixed(4)}, ${run.fresh.seconds.toFixed(0)} s
    ${run.fresh.content.slice(0, 300).replace(/\n/g, " | ")}
`);
}
console.log(`Total cost $${total.toFixed(4)}. Full results in ${outFile}`);
