/**
 * Tools
 *
 * Tool schemas and execution handlers for fact-checking pipelines.
 */

import { Readability } from "@mozilla/readability";
import { generateText } from "ai";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { xai } from "../llm/xai";
import { extractCitations, llm } from "../llm/llm";
import { countNoteLength } from "../write/writeNote";
import { getBotConfig } from "../utils/botConfig";
import {
  GEMINI_MODEL,
  GROK_MODEL, PERPLEXITY_MODEL,
  calculateGrokCost, extractOpenRouterCost,
  type TokenCost,
} from "../utils/pricing";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";
const SEARXNG_MAX_RESULTS = 10;

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

// --- Tool schemas ---

export const GROK_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "grok_search",
    description: "Search X/Twitter using Grok for related tweets (potentially with their comments) and latest news.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "What to search for on X/Twitter." },
      },
      required: ["query"],
    },
  },
};

export const PERPLEXITY_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "perplexity_search",
    description: "Search the web using Perplexity AI.",
    parameters: {
      type: "object" as const,
      properties: {
        prompt: { type: "string" as const, description: "The search prompt. Can include rich context" },
      },
      required: ["prompt"],
    },
  },
};

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

export const PROPOSE_NOTES_TOOL = {
  type: "function" as const,
  function: {
    name: "propose_notes",
    description: "Propose 3-4 community note variants. The system evaluates each and picks the best.",
    parameters: {
      type: "object" as const,
      properties: {
        notes: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              note_text: {
                type: "string" as const,
                description: "The community note text. Target 240-260 non-URL characters. Hard max 275.",
              },
              sources: {
                type: "array" as const,
                items: { type: "string" as const },
                description: "Source URLs for this note variant.",
              },
            },
            required: ["note_text", "sources"],
          },
          minItems: 1,
        },
      },
      required: ["notes"],
    },
  },
};

export const NO_CORRECTION_TOOL = {
  type: "function" as const,
  function: {
    name: "no_correction_needed",
    description:
      "Call when no community note should be written (opinion/satire, correct post, or insufficient evidence).",
    parameters: {
      type: "object" as const,
      properties: {
        reason: { type: "string" as const, description: "Why no correction is needed." },
      },
      required: ["reason"],
    },
  },
};

// Claude built-in tools (OpenRouter passthrough)
export const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" };
export const CODE_EXECUTION_TOOL = { type: "code_execution_20250522" as const, name: "code_execution" };

// --- Build tool list ---

export function buildToolList(): any[] {
  const config = getBotConfig();
  const isAnthropic = config.model.startsWith("anthropic/");
  const tools: any[] = [
    GROK_SEARCH_TOOL,
    PROPOSE_NOTES_TOOL,
    NO_CORRECTION_TOOL,
  ];

  if (isAnthropic) {
    tools.push(CODE_EXECUTION_TOOL);
  }

  // Web search: native (Claude web_search via OpenRouter), perplexity, or searxng
  if (config.web_search === "native") {
    tools.push(WEB_SEARCH_TOOL);
  } else if (config.web_search === "searxng" || config.web_search === "searxng_summarized") {
    tools.push(GOOGLE_SEARCH_TOOL);
  } else {
    tools.push(PERPLEXITY_SEARCH_TOOL);
  }

  tools.push(WEB_FETCH_TOOL);

  return tools;
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
      return getBotConfig().web_search === "searxng_summarized"
        ? handleGoogleSearchSummarized(args.query)
        : handleGoogleSearchRaw(args.query);
    case "web_fetch":
      return handleWebFetch(args.url);
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

  const { text, usage, steps } = await generateText({
    model: xai.responses(GROK_MODEL) as any,
    prompt: query,
    tools: {
      x_search: xai.tools.xSearch({ enableImageUnderstanding: true }) as any,
    },
  });

  const searchCalls = steps?.reduce(
    (n, s) => n + (s.toolCalls?.filter((tc) => tc.toolName === "x_search").length ?? 0),
    0,
  ) ?? 0;
  const cost = calculateGrokCost(
    usage?.inputTokens ?? 0,
    usage?.outputTokens ?? 0,
    searchCalls,
  );

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

interface SearxngResult {
  title: string;
  url: string;
  content: string;
}

async function fetchSearxngResults(query: string): Promise<SearxngResult[]> {
  const endpoint = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&engines=google`;
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CommunityNotesBot/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
  const data: any = await response.json();
  const results: any[] = data?.results ?? [];
  return results.slice(0, SEARXNG_MAX_RESULTS).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
  }));
}

function formatSearxngResults(results: SearxngResult[]): string {
  if (results.length === 0) return "No results.";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content}`)
    .join("\n\n");
}

export async function handleGoogleSearchRaw(query: string): Promise<ToolResult> {
  try {
    const results = await fetchSearxngResults(query);
    return { output: { results: formatSearxngResults(results) }, isTerminal: false };
  } catch (err: any) {
    return { output: { error: `Google search failed: ${err?.message}` }, isTerminal: false };
  }
}

export async function handleGoogleSearchSummarized(query: string): Promise<ToolResult> {
  let results: SearxngResult[];
  try {
    results = await fetchSearxngResults(query);
  } catch (err: any) {
    return { output: { error: `Google search failed: ${err?.message}` }, isTerminal: false };
  }

  const prompt = `You are a research assistant. The user searched for: "${query}"

Here are the search results:
${formatSearxngResults(results)}

Summarize the most relevant findings. Include the URLs of the most important sources inline in your summary. Focus on factual claims and verifiable information.`;

  const response = await llm.create({
    model: GEMINI_MODEL,
    messages: [{ role: "user" as const, content: prompt }],
  });
  const summary = response.choices?.[0]?.message?.content ?? "";
  const cost = extractOpenRouterCost(response);

  return { output: { results: summary }, isTerminal: false, cost };
}

export async function handleWebFetch(url: string): Promise<ToolResult> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CommunityNotesBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return { output: `Fetch failed: HTTP ${response.status}`, isTerminal: false };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/") && !contentType.includes("json")) {
      return { output: `Non-text content: ${contentType}`, isTerminal: false };
    }

    const html = await response.text();

    // Try Readability extraction → Turndown to markdown
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();

    let markdown: string;
    if (article?.content) {
      const titleLine = article.title ? `# ${article.title}\n\n` : "";
      markdown = titleLine + turndown.turndown(article.content);
    } else {
      // Fallback: strip HTML tags for non-article pages
      markdown = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    return { output: markdown.slice(0, 20000), isTerminal: false };
  } catch (err: any) {
    return { output: `Fetch error: ${err?.message?.slice(0, 200)}`, isTerminal: false };
  }
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
