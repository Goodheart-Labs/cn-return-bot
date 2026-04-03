/**
 * Tool-Calling Loop
 *
 * Runs Claude 4.6 Opus with tool access in a loop until a terminal tool
 * (propose_notes or no_correction_needed) is called, or iterations exhaust.
 * When propose_notes is called, evaluates each candidate and picks the best.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineResult, PostContent } from "../../bots/types";
import type { GeminiMediaResult } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "./agentAuthorHistory";
import type { AgentConfig } from "./agentConfig";
import { llm } from "../llm/llm";
import { evaluateNote } from "../score/noteEvaluationFilter";
import { getTweetLog } from "../utils/tweetLog";
import { buildToolList, executeToolCall } from "./agentTools";
import { SYSTEM_PROMPT, buildUserMessage } from "./agentPrompt";

const MAX_ITERATIONS = 50;
const MODEL = "anthropic/claude-opus-4.6";

interface ProposedNote {
  noteText: string;
  sources: string[];
  allUrls: string;
}

interface TerminalResult {
  type: "submit" | "no_correction";
  proposedNotes?: ProposedNote[];
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
  log?.set("agent.messages.0.systemPrompt", SYSTEM_PROMPT);
  log?.set("agent.messages.0.userMessage", userMessage);
  log?.set("agent.author", {
    name: post.author_name,
    description: post.author_description,
    followers: post.author_followers,
    tweetCount: post.author_tweet_count,
    noteHistory: authorHistory ?? null,
  });

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
    log?.set(`agent.messages.${iteration}.content`, message.content ?? "");

    // Log reasoning/thinking if present (OpenRouter extended thinking)
    const reasoning = (message as any).reasoning;
    if (reasoning) {
      log?.set(`agent.messages.${iteration}.reasoning`, reasoning);
    }

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
        // Built-in tool reported as custom type — parse and execute normally
        const custom = (toolCall as any).custom;
        name = custom?.name ?? (toolCall as any).type ?? "unknown_builtin";
        try {
          args = custom?.input ? JSON.parse(custom.input) : {};
        } catch {
          args = { raw: custom?.input };
        }
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
      if (name === "propose_notes" && result.output?.success) {
        const proposedNotes: ProposedNote[] = (args.notes ?? []).map(
          (n: { note_text: string; sources: string[] }) => {
            const sources = (n.sources ?? []).filter(Boolean);
            return { noteText: n.note_text, sources, allUrls: sources.join(" ") };
          },
        );
        terminalResult = { type: "submit", proposedNotes };
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

  if (terminalResult?.type === "submit" && terminalResult.proposedNotes?.length) {
    // Evaluate each proposed note in parallel and pick the best
    const evalResults = await Promise.all(
      terminalResult.proposedNotes.map(async (proposed) => {
        const fullText = proposed.noteText + " " + proposed.allUrls;
        try {
          const evalResponse = await evaluateNote(post.id, fullText);
          return { proposed, score: evalResponse.data?.claim_opinion_score };
        } catch (err: any) {
          return { proposed, score: undefined, error: err?.message };
        }
      }),
    );

    // Enrich the existing propose_notes tool call log with eval scores
    const existingLog = log?.get(`agent.messages.${iteration}.propose_notes`) as any;
    if (existingLog) {
      existingLog.eval_scores = evalResults.map((r) => ({
        score: r.score,
        error: (r as any).error,
      }));
      log?.set(`agent.messages.${iteration}.propose_notes`, existingLog);
    }

    // Pick highest-scoring note (fall back to first if all evals fail)
    const scored = evalResults.filter((r) => r.score != null);
    const best = scored.length > 0
      ? scored.reduce((a, b) => (b.score! > a.score! ? b : a))
      : evalResults[0]!;

    log?.set("note.eval_score", best.score);

    return {
      post,
      botId,
      lastStage: "agent_complete",
      searchContextResult: {
        text: content.text,
        searchResults,
        citations: best.proposed.sources,
      },
      noteResult: {
        note: best.proposed.noteText,
        url: best.proposed.allUrls,
        status: "CORRECTION WITH TRUSTWORTHY CITATION",
      },
      checkResult: "YES",
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
