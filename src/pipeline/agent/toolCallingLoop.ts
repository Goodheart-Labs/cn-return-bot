/**
 * Tool-Calling Loop
 *
 * Runs Claude 4.6 Opus with tool access in a loop until a terminal tool
 * (submit_note or no_correction_needed) is called, or iterations exhaust.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineResult, PostContent } from "../../bots/types";
import type { GeminiMediaResult } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "./agentAuthorHistory";
import type { AgentConfig } from "./agentConfig";
import { llm } from "../llm/llm";
import { getTweetLog } from "../utils/tweetLog";
import { buildToolList, executeToolCall } from "./agentTools";
import { SYSTEM_PROMPT, buildUserMessage } from "./agentPrompt";

const MAX_ITERATIONS = 50;
const MODEL = "anthropic/claude-opus-4.6";

interface TerminalResult {
  type: "submit" | "no_correction";
  noteText?: string;
  sources?: Array<{ url: string; supporting_snippet: string }>;
  primaryUrl?: string;
  reason?: string;
}

export async function runToolCallingLoop(
  post: Post,
  content: PostContent,
  config: AgentConfig,
  mediaResult: GeminiMediaResult,
  authorHistory?: AuthorNoteHistory,
): Promise<PipelineResult> {
  const log = getTweetLog();
  const startMs = Date.now();
  const botId = "agent"; // overridden by caller with deriveBotName

  // Build quoted post text
  const quotedRef = post.referenced_tweets?.find((rt) => rt.type === "quoted");
  const quotedPostText = quotedRef && post.referenced_tweet_data
    ? post.referenced_tweet_data.text
    : undefined;

  const now = new Date();
  const userMessage = buildUserMessage({
    tweetText: content.text,
    tweetId: post.id,
    tweetDate: post.created_at,
    quotedPostText,
    tweetMedia: mediaResult.tweetMedia,
    quotedTweetMedia: mediaResult.quotedTweetMedia,
    authorName: post.author_name,
    authorDescription: post.author_description,
    authorFollowers: post.author_followers,
    authorTweetCount: post.author_tweet_count,
    authorNoteHistory: authorHistory,
    currentDate: now.toISOString().split("T")[0]!,
    currentTime: now.toISOString().split("T")[1]!.slice(0, 5),
  });

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const tools = buildToolList(config, post.id);

  // Log initial state
  log?.set("agent.config", config);
  log?.set("agent.systemPrompt", SYSTEM_PROMPT);
  log?.set("agent.userMessage", userMessage);

  let terminalResult: TerminalResult | null = null;
  let iteration = 0;
  let allSearchOutputs: string[] = [];

  while (terminalResult === null && iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await llm.create({
      model: MODEL,
      messages,
      tools,
      // @ts-expect-error OpenRouter extended thinking
      reasoning: { effort: "high" },
    });

    const message = response.choices?.[0]?.message;
    if (!message) {
      console.error("[toolCallingLoop] No message in response");
      break;
    }

    // Log LLM response
    log?.set(`agent.messages.${iteration}.llm_response`, message.content ?? "");

    // No tool calls — model is done without using a terminal tool
    if (!message.tool_calls?.length) {
      terminalResult = {
        type: "no_correction",
        reason: typeof message.content === "string" ? message.content : "No tool calls made",
      };
      break;
    }

    // Add assistant message (with tool_calls) to conversation
    messages.push(message);

    // Execute each tool call
    for (const toolCall of message.tool_calls) {
      // Discriminate between function tool calls and custom (built-in) tool calls
      let name: string;
      let args: Record<string, any> = {};

      if (toolCall.type === "function") {
        name = toolCall.function.name;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = { raw: toolCall.function.arguments };
        }
      } else {
        // Custom tool (web_search, web_fetch, code_execution) — handled by OpenRouter
        // Just skip local execution; OpenRouter returns results in the next response
        name = (toolCall as any).custom?.name ?? "unknown_custom";
        continue;
      }

      const toolStartMs = Date.now();
      const result = await executeToolCall(name, args, post.id);
      const toolDurationMs = Date.now() - toolStartMs;

      // Log tool call
      log?.set(`agent.messages.${iteration}.${name}`, {
        args,
        result: result.output,
        durationMs: toolDurationMs,
      });

      // Add tool result to conversation
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
      });

      // Track search outputs for PipelineResult.searchContextResult
      if (name === "grok_search" || name === "perplexity_search") {
        const searchText = result.output?.results ?? JSON.stringify(result.output);
        allSearchOutputs.push(`--- ${name} ---\n${searchText}`);
      }

      // Check for terminal tools
      if (name === "submit_note" && result.output?.success) {
        terminalResult = {
          type: "submit",
          noteText: args.note_text,
          sources: args.sources,
          primaryUrl: args.sources?.[0]?.url ?? "",
        };
        break;
      }
      if (name === "no_correction_needed") {
        terminalResult = {
          type: "no_correction",
          reason: args.reason,
        };
        break;
      }
    }
  }

  // Log totals
  log?.set("agent.iterations", iteration);
  log?.set("agent.totalDurationMs", Date.now() - startMs);

  // Map to PipelineResult
  const searchResults = allSearchOutputs.join("\n\n");

  if (terminalResult?.type === "submit" && terminalResult.noteText) {
    return {
      post,
      botId,
      lastStage: "agent_complete",
      searchContextResult: {
        text: content.text,
        searchResults,
        citations: extractCitationsFromSources(terminalResult.sources),
      },
      noteResult: {
        note: terminalResult.noteText,
        url: terminalResult.primaryUrl ?? "",
        status: "CORRECTION WITH TRUSTWORTHY CITATION",
      },
      checkResult: "YES", // Agent self-verified via web_fetch
    };
  }

  if (terminalResult?.type === "no_correction") {
    return {
      post,
      botId,
      lastStage: "agent_complete",
      searchContextResult: {
        text: content.text,
        searchResults,
        citations: [],
      },
      noteResult: {
        note: "",
        url: "",
        status: "NO MISSING CONTEXT",
      },
    };
  }

  // Loop exhausted without terminal tool
  return {
    post,
    botId,
    lastStage: "agent_exhausted",
    searchContextResult: {
      text: content.text,
      searchResults,
      citations: [],
    },
    noteResult: { note: "", url: "", status: "ERROR" },
    error: `Tool-calling loop exhausted after ${MAX_ITERATIONS} iterations`,
  };
}

function extractCitationsFromSources(
  sources?: Array<{ url: string; supporting_snippet: string }>,
): string[] {
  if (!sources) return [];
  return sources.map((s) => s.url).filter(Boolean);
}
