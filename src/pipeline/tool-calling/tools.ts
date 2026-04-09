/**
 * Agent Tools
 *
 * Tool schemas and handlers for the agentic bot.
 * Tools are either Claude built-in (handled by OpenRouter) or custom function tools.
 */

import { Readability } from "@mozilla/readability";
import { generateText } from "ai";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { xai } from "../llm/xai";
import { extractCitations, llm } from "../llm/llm";
import { countNoteLength } from "../write/writeNote";
import type { BotConfig } from "../utils/botConfig";
import {
  GROK_MODEL, PERPLEXITY_MODEL,
  calculateGrokCost, extractOpenRouterCost,
  type TokenCost,
} from "../utils/pricing";

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
        query: { type: "string" as const, description: "The search query." },
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

export function buildToolList(config: BotConfig): any[] {
  const isAnthropic = config.model.startsWith("anthropic/");

  const tools: any[] = [
    GROK_SEARCH_TOOL,
    WEB_FETCH_TOOL,
    PROPOSE_NOTES_TOOL,
    NO_CORRECTION_TOOL,
  ];

  if (isAnthropic) {
    tools.push(CODE_EXECUTION_TOOL);
  }

  if (config.search_mode === "native-search") {
    tools.push(WEB_SEARCH_TOOL);
  } else {
    tools.push(PERPLEXITY_SEARCH_TOOL);
  }

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
      return handlePerplexitySearch(args.query);
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

export async function handlePerplexitySearch(query: string): Promise<ToolResult> {
  const result = await llm.create({
    model: PERPLEXITY_MODEL,
    messages: [{ role: "user" as const, content: query }],
  });

  const content = result.choices?.[0]?.message?.content ?? "";
  const citations = extractCitations(result);
  const cost = extractOpenRouterCost(result);

  return { output: { results: content, citations }, isTerminal: false, cost };
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
