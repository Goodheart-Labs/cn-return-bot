/* GPT's web tools: a Google search through Serper, and opening a page and
 * finding text in it through the pipeline's fetch ladder. They replace
 * OpenAI's hosted web search, which charges $0.01 per search and bills the
 * page text it reads at full price on every request (GOO-734). Here a search
 * costs Serper's fee, a page is free to fetch, and its text is an ordinary tool
 * result. So it stays in the conversation, and later turns read it from the
 * cache.
 *
 * One set of tools serves a whole run, so the main agent and its subagents
 * share the fetched pages, and a page is fetched only once per run.
 *
 * A tool error, such as Serper staying down through its retries, ends the run
 * instead of reaching the model as a message, so a broken search never passes
 * as "no results". A page the ladder could not fetch is an ordinary answer. */

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";
import { fetchSearchResults, fetchWebPage, formatSearchResults } from "../pipeline/tool-calling/tools";
import { findInPage, pageLines, pageWindow, type PageLines } from "./pageText";

/** One call of a web tool, for the run's log. Through OpenRouter the hosted
 *  search never showed what GPT looked for; these calls show it. */
export type WebToolCall = { tool: "search" | "open_page" | "find_in_page"; input: Record<string, unknown>; outputChars: number };

/** What the web tools did in a run: the counts for its cost, and every call. */
export type WebToolUse = { searches: number; pagesFetched: number; calls: WebToolCall[] };

export function webTools(use: WebToolUse): Tool[] {
  const pages = new Map<string, Promise<PageLines | string>>();

  function logged(call: Omit<WebToolCall, "outputChars">, output: string): string {
    use.calls.push({ ...call, outputChars: output.length });
    return output;
  }

  /** The page as lines, or why it could not be fetched. The cited URL is the
   *  one the text came from, which is an archive copy when the live page refused us. */
  function readPage(url: string): Promise<PageLines | string> {
    if (!pages.has(url)) {
      use.pagesFetched += 1;
      pages.set(url, fetchWebPage(url).then((page) => (page.ok ? pageLines(page.fetchedUrl, page.content) : `Could not open ${url}. ${page.content}`)));
    }
    return pages.get(url)!;
  }

  const search = tool({
    name: "search",
    description: "Searches Google. Returns up to 10 results, each with its title, URL, date and snippet. Quotation marks for exact phrases and site: work.",
    parameters: z.object({ query: z.string() }),
    errorFunction: null,
    execute: async ({ query }) => {
      use.searches += 1;
      return logged({ tool: "search", input: { query } }, formatSearchResults(await fetchSearchResults(query)));
    },
  });

  const openPage = tool({
    name: "open_page",
    description: "Opens a web page and shows its text as numbered lines, one window at a time. Give a line number to read on from there.",
    parameters: z.object({ url: z.string(), line: z.number().int().nullable().describe("The first line to show. Null for the start of the page.") }),
    errorFunction: null,
    execute: async ({ url, line }) => {
      const page = await readPage(url);
      return logged({ tool: "open_page", input: { url, line } }, typeof page === "string" ? page : pageWindow(page, line ?? 0));
    },
  });

  const findText = tool({
    name: "find_in_page",
    description: "Finds every line of a web page that contains the text, ignoring case. Use it to check that a quote is on the page word for word.",
    parameters: z.object({ url: z.string(), text: z.string() }),
    errorFunction: null,
    execute: async ({ url, text }) => {
      const page = await readPage(url);
      return logged({ tool: "find_in_page", input: { url, text } }, typeof page === "string" ? page : findInPage(page, text));
    },
  });

  return [search, openPage, findText];
}
