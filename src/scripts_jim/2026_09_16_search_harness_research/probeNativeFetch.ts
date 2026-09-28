/**
 * How good is OpenRouter's server-side web_fetch for Muse, compared with our own
 * fetch ladder? For each URL, asks Muse to read it through openrouter:web_fetch
 * with three engines (native, openrouter, exa) and runs our fetchWebPage on the
 * same URL from this machine. The URLs failed in prod with our ladder
 * (2026-09-02 to 2026-09-16), plus one long Wikipedia page that tests how much
 * of a page the model gets to see.
 * Run from the repo root:
 *   bun run src/scripts_jim/2026_09_16_search_harness_research/probeNativeFetch.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fetchWebPage } from "../../pipeline/tool-calling/tools";

const MODEL = "meta/muse-spark-1.3-contributor";
const ENGINES = ["native", "openrouter", "exa"] as const;
const MAX_CONTENT_TOKENS = 30_000;
const CONCURRENCY = 6;
const OUT = "src/scripts_jim/2026_09_16_search_harness_research/native_fetch_results.json";

const FAILED_IN_PROD = [
  "https://www.nytimes.com/2026/08/27/climate/nepal-flooding-climate-change.html",
  "https://www.reuters.com/legal/government/whats-next-lindsay-clancy-after-mistrial-2026-09-04/",
  "https://www.forbes.com/sites/news/2026/09/01/what-to-know-about-the-trees-trump-is-cutting-down-around-dc/",
  "https://www.fsis.usda.gov/inspection/import-export/import-guidance/fsis-import-procedures-meat-poultry-egg-products",
  "https://www.britannica.com/topic/Raiders-of-the-Lost-Ark",
  "https://factcheck.afp.com/doc.afp.com.98NQ2NQ",
  "https://www.fbi.gov/news/speeches-and-testimony/director-wray-s-remarks-at-press-briefing-on-butler-pennsylvania-assassination-attempt-071424",
  "https://www.usnews.com/news/world/articles/2026-09-02/ceuta-residents-call-for-calm-as-spain-rallies-over-enclaves-migrant-crisis",
  "https://www.ndtv.com/sports/goat-debate-settled-lionel-messi-breaks-internet-with-receipt-style-instagram-post-12102143",
  "https://uu.diva-portal.org/smash/get/diva2%3A1927772/FULLTEXT01.pdf",
];
const LONG_PAGE = "https://en.wikipedia.org/wiki/Measles";
// Section headings at about 10,000, 45,000 and 62,000 characters into the page.
const LONG_PAGE_SECTIONS = ["Signs and symptoms", "Europe", "History"];

const ANSWER_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "fetch_report",
    strict: true,
    schema: {
      type: "object",
      properties: {
        fetched: { type: "boolean" },
        error: { type: ["string", "null"] },
        title: { type: "string" },
        first_sentence: { type: "string" },
        section_first_sentences: { type: "array", items: { type: "string" } },
      },
      required: ["fetched", "error", "title", "first_sentence", "section_first_sentences"],
      additionalProperties: false,
    },
  },
};

function buildPrompt(url: string, sections: string[]): string {
  const sectionAsk = sections.length
    ? ` For each of these section headings, in order, copy the first sentence under it word for word, or write "NOT VISIBLE" if that part of the page did not reach you: ${sections.map((s) => `"${s}"`).join(", ")}.`
    : " Leave section_first_sentences empty.";
  return `Call web_fetch on ${url}. Report only what the tool returned, never your own knowledge. If the tool failed or returned an error page, set fetched to false and copy the error text. Otherwise give the page title and copy the first sentence of the main text word for word.${sectionAsk}`;
}

function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function askMuse(url: string, engine: string, sections: string[]) {
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_TESTING_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      usage: { include: true },
      messages: [{ role: "user", content: buildPrompt(url, sections) }],
      tools: [{ type: "openrouter:web_fetch", parameters: { engine, max_content_tokens: MAX_CONTENT_TOKENS } }],
      response_format: ANSWER_FORMAT,
    }),
  });
  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return {
    url, engine,
    http: response.status,
    seconds: (Date.now() - started) / 1000,
    provider: data.provider ?? null,
    cost: data.usage?.cost ?? null,
    promptTokens: data.usage?.prompt_tokens ?? null,
    serverTools: data.usage?.server_tool_use_details ?? null,
    report: extractJson(content),
    rawContent: content.slice(0, 1500),
    error: data.error ? JSON.stringify(data.error).slice(0, 500) : null,
    messageKeys: Object.keys(data.choices?.[0]?.message ?? {}),
  };
}

async function runOurLadder(url: string) {
  const started = Date.now();
  const result = await fetchWebPage(url, { maxChars: 500_000 });
  return { url, engine: "our ladder (this VPS)", ok: result.ok, seconds: (Date.now() - started) / 1000, chars: result.content.length, head: result.content.slice(0, 300) };
}

async function inBatches<T>(jobs: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < jobs.length; i += CONCURRENCY) results.push(...(await Promise.all(jobs.slice(i, i + CONCURRENCY).map((j) => j()))));
  return results;
}

const museJobs = [...FAILED_IN_PROD, LONG_PAGE].flatMap((url) =>
  ENGINES.map((engine) => () => askMuse(url, engine, url === LONG_PAGE ? LONG_PAGE_SECTIONS : [])),
);
const museResults = await inBatches(museJobs);
const ladderResults = await inBatches([...FAILED_IN_PROD, LONG_PAGE].map((url) => () => runOurLadder(url)));
writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), museResults, ladderResults }, null, 2));

for (const url of [...FAILED_IN_PROD, LONG_PAGE]) {
  console.log(`\n### ${url}`);
  const ladder = ladderResults.find((r) => r.url === url)!;
  console.log(`  our ladder: ${ladder.ok ? "OK" : "FAILED"} ${ladder.chars} chars ${ladder.seconds.toFixed(1)}s | ${ladder.head.replace(/\s+/g, " ").slice(0, 120)}`);
  for (const r of museResults.filter((m) => m.url === url)) {
    const rep = r.report;
    console.log(`  ${r.engine.padEnd(10)} HTTP ${r.http} ${r.seconds.toFixed(1)}s $${r.cost} prov=${r.provider} tools=${JSON.stringify(r.serverTools)} | fetched=${rep?.fetched} err=${String(rep?.error ?? r.error ?? "").slice(0, 80)} | ${String(rep?.first_sentence ?? "").slice(0, 110)}`);
    if (rep?.section_first_sentences?.length) for (const s of rep.section_first_sentences) console.log(`       section: ${String(s).slice(0, 140)}`);
  }
}
console.log("\nmessage keys seen:", [...new Set(museResults.flatMap((r) => r.messageKeys))]);
console.log("total cost $", museResults.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(4));
