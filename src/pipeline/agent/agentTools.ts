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

const SUBMIT_NOTE_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_note",
    description:
      "Submit a community note correction. Only call this when you are highly confident that the correction is accurate, well-sourced, and will be rated helpful by a broad audience. You must have verified every source URL with web_fetch first.",
    parameters: {
      type: "object" as const,
      properties: {
        note_text: {
          type: "string" as const,
          description: "The community note text. Target 240-260 non-URL characters. Hard max 275.",
        },
        sources: {
          type: "array" as const,
          items: {
            type: "object" as const,
            properties: {
              url: { type: "string" as const },
              supporting_snippet: {
                type: "string" as const,
                description: "A direct quote or paraphrase from this source that supports the correction.",
              },
            },
            required: ["url", "supporting_snippet"],
          },
          description: "Sources. First is the primary URL. Don't add redundant sources.",
        },
      },
      required: ["note_text", "sources"],
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
    SUBMIT_NOTE_TOOL,
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
    case "submit_note":
      return handleSubmitNote(args.note_text, args.sources);
    case "no_correction_needed":
      return { output: { acknowledged: true }, isTerminal: true };
    default:
      // Built-in tools (web_search, web_fetch, code_execution) are handled by OpenRouter
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

function handleSubmitNote(
  noteText: string,
  _sources: Array<{ url: string; supporting_snippet: string }>,
): ToolResult {
  const charCount = countNoteLength(noteText);

  if (charCount > 275) {
    return {
      output: {
        success: false,
        error: `Note is ${charCount} non-URL characters, exceeds 275 limit. Shorten it.`,
        effective_char_count: charCount,
      },
      isTerminal: false,
    };
  }

  return {
    output: {
      success: true,
      effective_char_count: charCount,
    },
    isTerminal: true,
  };
}
