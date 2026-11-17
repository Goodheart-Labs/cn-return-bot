/**
 * The tool schemas and the handlers that execute them, for the fact-checking
 * pipelines.
 */

import { generateText } from "ai";
import { grokCallCost, xai } from "../llm/xai";
import { extractCitations, llm } from "../llm/llm";
import { countNoteLength } from "../utils/noteLength";
import { getBotConfig } from "../ab-testing/botConfig";
import { readPageForModel } from "../fetch/readPage";
import {
  GEMINI_MODEL,
  GROK_MODEL, PERPLEXITY_MODEL,
  addTokenCost, extractOpenRouterCost, serperSearchCost,
  type TokenCost,
} from "../cost-tracking/pricing";
import { fetchSearchResults, formatSearchResults, SearchUnavailableError, type SearchResult } from "./serper";
import { buildSearchSummarizePrompt } from "../prompts/tool-calling/searchSummarize";
export { fetchSearchResults, formatSearchResults, SearchUnavailableError };
export type { SearchResult };

// --- Tool schemas ---

export const GOOGLE_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "google_search",
    description: "Search Google for web pages matching a query. Returns titles, URLs, and snippets.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "The Google search query." },
      },
      required: ["query"],
    },
  },
};

export const WEB_FETCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_fetch",
    description: "Fetch a URL and extract its main content as markdown.",
    parameters: {
      type: "object" as const,
      properties: {
        url: { type: "string" as const, description: "The URL to fetch." },
      },
      required: ["url"],
    },
  },
};

// Claude's built-in web search tool, which OpenRouter passes through. The
// native-search dispatch of simple-bot uses it.
export const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" };

// Claude's built-in web fetch tool, also passed through by OpenRouter. Claude
// reads the page inside the call, so the page never round-trips through us.
// The fetched text is billed as input tokens, hence the per-page token cap.
export function webFetchNativeTool(limits: { maxUses: number; maxContentTokens: number }) {
  return {
    type: "web_fetch_20250910" as const,
    name: "web_fetch",
    max_uses: limits.maxUses,
    max_content_tokens: limits.maxContentTokens,
  };
}

// OpenRouter's web_search server tool on the model provider's own engine. For a
// Muse request that is Meta's search, which also opens pages. OpenRouter runs it
// inside the request and bills the searches in usage.cost.
export const OPENROUTER_NATIVE_WEB_SEARCH_TOOL = {
  type: "openrouter:web_search" as const,
  parameters: { engine: "native" as const },
};

/** Meta's search tool cites the lines of the pages it opened with markers such
 *  as 【1586541899417117766†L16-L18】, which point into its own page cache and mean
 *  nothing to us. They are removed so they cannot leak into a note. */
export function stripBrowserLineCitations(text: string): string {
  return text.replace(/\s*【[^】]*†[^】]*】/g, "");
}

// --- Tool handlers ---

export interface ToolResult {
  output: any;
  isTerminal: boolean;
  cost?: TokenCost;
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
): Promise<ToolResult> {
  switch (toolName) {
    case "grok_search":
      return handleGrokSearch(args.query);
    case "perplexity_search":
      return handlePerplexitySearch(args.prompt ?? args.query);
    case "google_search":
      return getBotConfig().web_search === "serper_summarized"
        ? handleGoogleSearchSummarized(args.query)
        : handleGoogleSearchRaw(args.query);
    case "web_fetch":
      return { output: (await readPageForModel(args.url)).content, isTerminal: false };
    case "propose_notes":
      return handleProposeNotes(args.notes);
    case "no_correction_needed":
      return { output: { acknowledged: true }, isTerminal: true };
    default:
      return { output: { error: `Unknown tool: ${toolName}` }, isTerminal: false };
  }
}

export async function handleGrokSearch(query: string): Promise<ToolResult> {
  if (!process.env.XAI_API_KEY) {
    return { output: { error: "XAI_API_KEY not set" }, isTerminal: false };
  }

  const result = await generateText({
    model: xai.responses(GROK_MODEL) as any,
    prompt: query,
    tools: {
      x_search: xai.tools.xSearch({ enableImageUnderstanding: true }) as any,
    },
  });
  const { text } = result;
  const cost = grokCallCost(result, GROK_MODEL);

  return { output: { results: text }, isTerminal: false, cost };
}

export async function handlePerplexitySearch(prompt: string): Promise<ToolResult> {
  const result = await llm.create({
    model: PERPLEXITY_MODEL,
    messages: [{ role: "user" as const, content: prompt }],
  });

  const content = result.choices?.[0]?.message?.content ?? "";
  const citations = extractCitations(result);
  const cost = extractOpenRouterCost(result);

  return { output: { results: content, citations }, isTerminal: false, cost };
}


export async function handleGoogleSearchRaw(query: string): Promise<ToolResult> {
  try {
    const results = await fetchSearchResults(query);
    return { output: { results: formatSearchResults(results) }, isTerminal: false, cost: serperSearchCost() };
  } catch (err: any) {
    return { output: { error: `Google search failed: ${err?.message}` }, isTerminal: false };
  }
}

export async function handleGoogleSearchSummarized(query: string): Promise<ToolResult> {
  let results: SearchResult[];
  try {
    results = await fetchSearchResults(query);
  } catch (err: any) {
    return { output: { error: `Google search failed: ${err?.message}` }, isTerminal: false };
  }

  const prompt = buildSearchSummarizePrompt(query, formatSearchResults(results));

  const response = await llm.create({
    model: GEMINI_MODEL,
    messages: [{ role: "user" as const, content: prompt }],
  });
  const summary = response.choices?.[0]?.message?.content ?? "";
  const cost = serperSearchCost();
  addTokenCost(cost, extractOpenRouterCost(response));

  return { output: { results: summary }, isTerminal: false, cost };
}

export function handleProposeNotes(
  notes: Array<{ note_text: string; sources: string[] }>,
): ToolResult {
  const results = notes.map((n, i) => {
    const charCount = countNoteLength(n.note_text);
    return { index: i, charCount, tooLong: charCount > 275 };
  });

  const tooLong = results.filter((r) => r.tooLong);
  if (tooLong.length > 0) {
    const errors = tooLong.map(
      (r) => `Note ${r.index + 1}: ${r.charCount} chars (max 275)`,
    );
    return {
      output: { success: false, error: errors.join(". ") + ". Shorten them." },
      isTerminal: false,
    };
  }

  return {
    output: {
      success: true,
      note_count: notes.length,
      char_counts: results.map((r) => r.charCount),
    },
    isTerminal: true,
  };
}
