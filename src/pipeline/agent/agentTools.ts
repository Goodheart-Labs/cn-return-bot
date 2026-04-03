/**
 * Agent Tools
 *
 * Tool schemas and handlers for the agentic bot.
 * Tools are either Claude built-in (handled by OpenRouter) or custom function tools.
 */

import { generateText } from "ai";
import { xai } from "../llm/xai";
import { extractCitations, llm } from "../llm/llm";
import { countNoteLength } from "../write/writeNote";
import type { AgentConfig } from "./agentConfig";

// --- Tool schemas ---

const GROK_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "grok_search",
    description:
      "Search X/Twitter using Grok. Has access to real-time X data. Useful for: tweet context (thread, replies, quotes), latest breaking news, detecting AI-generated content (people point it out in comments), finding relevant reply URLs as sources. Grok will provide full tweet texts.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "What to search for on X/Twitter." },
      },
      required: ["query"],
    },
  },
};

const PERPLEXITY_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "perplexity_search",
    description: "Search the web using Perplexity AI. Returns search results with citations.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "The search query." },
      },
      required: ["query"],
    },
  },
};

const PROPOSE_NOTES_TOOL = {
  type: "function" as const,
  function: {
    name: "propose_notes",
    description:
      "Propose 3-4 community note variants. The system evaluates each and picks the best. Only call when highly confident that a correction is warranted. You must have verified every source URL with web_fetch first.",
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
                items: { type: "string" as const, description: "A verified source URL." },
                description: "Source URLs for this note variant.",
              },
            },
            required: ["note_text", "sources"],
          },
          description: "3-4 note variants with different phrasings or source combinations.",
          minItems: 1,
        },
      },
      required: ["notes"],
    },
  },
};

const NO_CORRECTION_TOOL = {
  type: "function" as const,
  function: {
    name: "no_correction_needed",
    description:
      "Call this only when you are highly confident that no good community note can be written for this post — after thorough search. Use when the post is opinion/satire, correct, or you genuinely cannot find strong contradicting evidence.",
    parameters: {
      type: "object" as const,
      properties: {
        reason: { type: "string" as const, description: "Why no correction is needed." },
      },
      required: ["reason"],
    },
  },
};

// Claude built-in tools (OpenRouter passthrough — name field is required)
const WEB_SEARCH_TOOL = { type: "web_search_20260209" as const, name: "web_search" };
const WEB_FETCH_TOOL = { type: "web_fetch_20250305" as const, name: "web_fetch" };
const CODE_EXECUTION_TOOL = { type: "code_execution_20250522" as const, name: "code_execution" };

// --- Build tool list ---

export function buildToolList(config: AgentConfig, _tweetId: string): any[] {
  const tools: any[] = [
    GROK_SEARCH_TOOL,
    WEB_FETCH_TOOL,
    CODE_EXECUTION_TOOL,
    PROPOSE_NOTES_TOOL,
    NO_CORRECTION_TOOL,
  ];

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
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  tweetId: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "grok_search":
      return handleGrokSearch(args.query, tweetId);
    case "perplexity_search":
      return handlePerplexitySearch(args.query);
    case "propose_notes":
      return handleProposeNotes(args.notes);
    case "no_correction_needed":
      return { output: { acknowledged: true }, isTerminal: true };
    case "web_fetch":
      return handleWebFetch(args.url);
    case "web_search":
      return { output: "Use grok_search or perplexity_search instead.", isTerminal: false };
    case "code_execution":
      return { output: "Code execution not available.", isTerminal: false };
    default:
      return { output: { error: `Unknown tool: ${toolName}` }, isTerminal: false };
  }
}

async function handleGrokSearch(query: string, tweetId: string): Promise<ToolResult> {
  if (!process.env.XAI_API_KEY) {
    return { output: { error: "XAI_API_KEY not set" }, isTerminal: false };
  }

  const tweetUrl = `https://x.com/i/status/${tweetId}`;
  const prompt = `${query}\n\nTweet URL for context: ${tweetUrl}\n\nProvide full tweet texts in your reply.`;

  const { text } = await generateText({
    model: xai.responses("grok-4-fast") as any,
    prompt,
    tools: {
      x_search: xai.tools.xSearch({ enableImageUnderstanding: true }) as any,
    },
  });

  return { output: { results: text }, isTerminal: false };
}

async function handlePerplexitySearch(query: string): Promise<ToolResult> {
  const result = await llm.create({
    model: "perplexity/sonar",
    messages: [
      {
        role: "system" as const,
        content: "Search the web for information. Include specific URLs for sources directly in the text.",
      },
      { role: "user" as const, content: query },
    ],
  });

  const content = result.choices?.[0]?.message?.content ?? "";
  const citations = extractCitations(result);

  return { output: { results: content, citations }, isTerminal: false };
}

async function handleWebFetch(url: string): Promise<ToolResult> {
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
    const text = await response.text();
    // Strip HTML tags for a rough plaintext extraction, cap at 15k chars
    const plain = text.replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000);
    return { output: plain, isTerminal: false };
  } catch (err: any) {
    return { output: `Fetch error: ${err?.message?.slice(0, 200)}`, isTerminal: false };
  }
}

function handleProposeNotes(
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
