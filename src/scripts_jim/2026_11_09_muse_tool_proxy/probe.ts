/**
 * Jim's idea for cheap research in the GPT note writer (GOO-734): GPT keeps
 * its usual web tools, search, open page and find in page, but each call is
 * carried out by Muse. We send Muse one prompt per tool call, with exactly the
 * inputs GPT chose. Muse runs the call with Meta's native search, and its
 * answer goes back to GPT word for word as the tool's output.
 *
 * This probe asks whether Muse does that faithfully. For every call it records
 * how many searches Meta ran, the cost and the time. Then it fetches each page
 * Muse claims to have read through our own fetch ladder, and counts how many
 * of the lines Muse pasted really are on that page word for word.
 *
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_11_09_muse_tool_proxy/probe.ts [--only search|open|find]
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { fetchWebPageInProcess } from "../../pipeline/tool-calling/tools";
import { OPEN_PAGE_PROMPT, FIND_IN_PAGE_PROMPT, SEARCH_PROMPT } from "./prompts";

const MODEL = "meta/muse-spark-1.3-contributor";
const OUT_DIR = path.join(import.meta.dir, "results");
/** A pasted line shorter than this is too generic to say anything about faithfulness, for example a heading. */
const MIN_LINE_CHARS_TO_CHECK = 40;
const NATIVE_SEARCH_TOOL = { type: "openrouter:web_search", parameters: { engine: "native" } };

type ToolCall =
  | { tool: "search"; query: string }
  | { tool: "open_page"; url: string; line?: number }
  | { tool: "find_in_page"; url: string; pattern: string; expectMatch: boolean };

// Calls of the kind GPT made in experiment 1 (GOO-687), on posts like the
// Pinker letter and the California ballot post. The pages are a mix: a .gov
// page, Wikipedia, a Substack post and a news site that blocks datacenters.
const CALLS: ToolCall[] = [
  { tool: "search", query: "Steven Pinker homicide rate Western Europe decline since Middle Ages" },
  { tool: "search", query: "California Proposition 50 2025 election results percentage" },
  { tool: "search", query: "CDC measles cases 2025 United States total" },
  { tool: "open_page", url: "https://www.cdc.gov/measles/data-research/index.html" },
  { tool: "open_page", url: "https://en.wikipedia.org/wiki/2025_California_Proposition_50" },
  { tool: "open_page", url: "https://www.astralcodexten.com/p/open-letter-to-steven-pinker" },
  { tool: "open_page", url: "https://www.reuters.com/world/us/" },
  { tool: "open_page", url: "https://en.wikipedia.org/wiki/2025_California_Proposition_50", line: 1200 },
  { tool: "open_page", url: "https://www.astralcodexten.com/p/my-california-ballot-2026" },
  { tool: "find_in_page", url: "https://en.wikipedia.org/wiki/2025_California_Proposition_50", pattern: "independent redistricting commission", expectMatch: true },
  { tool: "find_in_page", url: "https://www.cdc.gov/measles/data-research/index.html", pattern: "confirmed measles cases", expectMatch: true },
  { tool: "find_in_page", url: "https://en.wikipedia.org/wiki/2025_California_Proposition_50", pattern: "approved by 91 percent of voters", expectMatch: false },
];

function promptFor(call: ToolCall): string {
  switch (call.tool) {
    case "search": return SEARCH_PROMPT(call.query);
    case "open_page": return OPEN_PAGE_PROMPT(call.url, call.line);
    case "find_in_page": return FIND_IN_PAGE_PROMPT(call.url, call.pattern);
  }
}

async function callMuse(prompt: string) {
  const startedAt = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], tools: [NATIVE_SEARCH_TOOL], usage: { include: true } }),
  });
  const body: any = await response.json();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  const message = body.choices?.[0]?.message ?? {};
  return {
    content: String(message.content ?? ""),
    usage: body.usage,
    citations: (message.annotations ?? []).filter((a: any) => a.type === "url_citation").map((a: any) => a.url_citation?.url),
    searches: body.usage?.server_tool_use?.web_search_requests ?? null,
    costUsd: body.usage?.cost ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    seconds: (Date.now() - startedAt) / 1000,
  };
}

/** Lower case, no markdown punctuation, single spaces, so that a line Muse pasted
 *  matches our copy of the page even when the two render links or bold text differently. */
function normalise(text: string): string {
  return text
    .replace(/【[^】]*】/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`|]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** The browser tool wraps long lines and numbers them ("L12: "). The numbers go
 *  and the wrapped lines are joined again, so the text reads like the page. */
function withoutLineNumbers(content: string): string {
  return content
    .split("\n")
    .filter((line) => /^L\d+: ?/.test(line))
    .map((line) => line.replace(/^L\d+: ?/, ""))
    .join(" ");
}

/** The sentences of the tool output that are long enough to check. */
function checkableLines(content: string): string[] {
  return withoutLineNumbers(content)
    .split(/(?<=[.!?])\s+|\s*(?:\.\.\.|…)\s*/)
    .map(normalise)
    .filter((line) => line.length >= MIN_LINE_CHARS_TO_CHECK);
}

const URL_PATTERN = /https?:\/\/[^\s)\]>"'】]+/g;

const pageCache = new Map<string, string | null>();
async function ourCopy(url: string): Promise<string | null> {
  if (!pageCache.has(url)) {
    const page = await fetchWebPageInProcess(url);
    pageCache.set(url, page.ok ? normalise(page.content) : null);
  }
  return pageCache.get(url)!;
}

/** How many of the pasted lines are on any of the given pages word for word. */
async function faithfulness(content: string, urls: string[]) {
  const pages = (await Promise.all(urls.map(ourCopy))).filter((page): page is string => page !== null);
  const lines = checkableLines(content);
  const onPage = lines.filter((line) => pages.some((page) => page.includes(line)));
  return { pagesFetched: pages.length, pagesTried: urls.length, linesChecked: lines.length, linesOnPage: onPage.length, notOnPage: lines.filter((line) => !onPage.includes(line)).slice(0, 5) };
}

async function probe(call: ToolCall) {
  const muse = await callMuse(promptFor(call));
  console.log(`Muse answered ${JSON.stringify(call)} in ${muse.seconds.toFixed(0)} s`);
  const urls = call.tool === "search" ? [...new Set(muse.content.match(URL_PATTERN) ?? [])].slice(0, 8) : [call.url];
  const check = await faithfulness(muse.content, urls);
  const pageChars = call.tool === "search" ? null : (await ourCopy(call.url))?.length ?? null;
  return { call, ...muse, pageChars, check };
}

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const calls = CALLS.filter((call) => !only || call.tool.startsWith(only));
const results = await Promise.all(calls.map(async (call) => {
  try {
    return await probe(call);
  } catch (err) {
    return { call, error: (err as Error).message };
  }
}));

mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify(results, null, 2));
for (const result of results) {
  const label = JSON.stringify(result.call);
  if ("error" in result) { console.log(`${label}\n  ERROR ${result.error}\n`); continue; }
  console.log(`${label}
  searches ${result.searches}, $${result.costUsd?.toFixed(4)}, ${result.seconds.toFixed(0)} s, ${result.content.length} chars out (our copy of the page: ${result.pageChars ?? "n/a"} chars)
  lines on the page word for word: ${result.check.linesOnPage} of ${result.check.linesChecked} (pages fetched ${result.check.pagesFetched} of ${result.check.pagesTried})
  start: ${result.content.slice(0, 300).replace(/\n/g, " | ")}
`);
}
const total = results.reduce((sum, result) => sum + ("costUsd" in result ? result.costUsd ?? 0 : 0), 0);
console.log(`Total cost $${total.toFixed(4)}. Full results in ${outFile}`);
