/**
 * Multi-Agent Orchestrator
 *
 * Wires the researcher, notewriter, and source verifier together.
 * Manages turn routing, note evaluation, retry loops, and cost aggregation.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineResult, PostContent } from "../../bots/types";
import type { GeminiMediaResult } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "../agent/agentAuthorHistory";
import type { BotConfig } from "../agent/agentConfig";
import { evaluateNote } from "../score/noteEvaluationFilter";
import { getTweetLog } from "../utils/tweetLog";
import {
  emptyTokenCost,
  addTokenCost,
  type TokenCost,
} from "../agent/agentPricing";
import {
  type AgentState,
  initAgentState,
  addUserMessage,
  runAgentTurn,
} from "./agentFramework";
import { createResearcherDef, buildResearcherFirstMessage } from "./researcher";
import { createNotewriterDef } from "./notewriter";
import { createSourceVerifierDef } from "./sourceVerifier";

const MAX_TURNS = 10;

interface FlowTurn {
  agent: string;
  terminalTool: string;
  to?: string;
  noteCount?: number;
  selectedIndex?: number;
  evalScore?: number;
  durationMs: number;
}

interface SelectedNote {
  noteText: string;
  sources: string[];
  allUrls: string;
  evalScore?: number;
}

export async function runMultiAgentPipeline(
  post: Post,
  content: PostContent,
  config: BotConfig,
  mediaResult: GeminiMediaResult,
  authorHistory?: AuthorNoteHistory,
  mediaCost?: TokenCost,
  comments?: string,
): Promise<PipelineResult> {
  const log = getTweetLog();
  const startMs = Date.now();
  const botId = "multi-agent";

  // Build agent descriptions for system prompts
  const agentDefs = [
    { name: "researcher", desc: "Investigates factual claims in tweets using search tools and reports findings." },
    { name: "notewriter", desc: "Writes 3-4 community note variants based on research findings." },
    { name: "source_verifier", desc: "Verifies that cited sources support the community note correction." },
  ];
  const agentDescriptions = agentDefs
    .map((a) => `- ${a.name}: ${a.desc}`)
    .join("\n");

  // Create agent definitions
  const researcherDef = createResearcherDef(config, agentDescriptions);
  const notewriterDef = createNotewriterDef(agentDescriptions);
  const sourceVerifierDef = createSourceVerifierDef(agentDescriptions);

  // Initialize agent states (no LLM calls — just sets up messages arrays)
  const agents: Record<string, AgentState> = {
    researcher: initAgentState(researcherDef),
    notewriter: initAgentState(notewriterDef),
    source_verifier: initAgentState(sourceVerifierDef),
  };

  // Log initial state
  log?.set("multiAgent.config", config);
  log?.set("multiAgent.agents", agentDefs);
  log?.set("multiAgent.researcher.systemPrompt", researcherDef.systemPrompt);
  log?.set("multiAgent.notewriter.systemPrompt", notewriterDef.systemPrompt);
  log?.set("multiAgent.sourceVerifier.systemPrompt", sourceVerifierDef.systemPrompt);

  // Build and add researcher's first user message
  const quotedRef = post.referenced_tweets?.find((rt) => rt.type === "quoted");
  const quotedPostText =
    quotedRef && post.referenced_tweet_data
      ? post.referenced_tweet_data.text
      : undefined;

  const firstMessage = buildResearcherFirstMessage({
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
    comments,
  });
  addUserMessage(agents.researcher!, firstMessage);

  // Track state
  const flowTurns: FlowTurn[] = [];
  const allSearchOutputs: string[] = [];
  let selectedNote: SelectedNote | undefined;
  let researcherFindings = "";
  let currentAgentName = "researcher";
  let turnCount = 0;

  // Cost tracking
  const costs = {
    researcher: emptyTokenCost(),
    notewriter: emptyTokenCost(),
    sourceVerifier: emptyTokenCost(),
    media: mediaCost ?? emptyTokenCost(),
    total: emptyTokenCost(),
  };

  // Turn loop
  while (turnCount < MAX_TURNS) {
    turnCount++;
    const currentState = agents[currentAgentName]!;
    const turnStartMs = Date.now();

    const result = await runAgentTurn(currentState);
    const turnDurationMs = Date.now() - turnStartMs;
    allSearchOutputs.push(...result.searchOutputs);

    // Accumulate cost for this agent
    const costKey =
      currentAgentName === "source_verifier" ? "sourceVerifier" : currentAgentName;
    addTokenCost(costs[costKey as keyof typeof costs], result.cost);

    // Build flow turn entry
    const flowTurn: FlowTurn = {
      agent: currentAgentName,
      terminalTool: result.terminalTool,
      durationMs: turnDurationMs,
    };

    // Route based on terminal tool
    if (result.terminalTool === "no_correction_needed" || result.terminalTool === "error") {
      flowTurn.to = undefined;
      flowTurns.push(flowTurn);
      logFinal(log, flowTurns, costs, mediaCost, startMs);

      return {
        post,
        botId,
        lastStage: "multi_agent_complete",
        searchContextResult: {
          text: content.text,
          searchResults: allSearchOutputs.join("\n\n"),
          citations: [],
        },
        noteResult: {
          note: "",
          url: "",
          status: result.terminalTool === "error" ? "ERROR" : "NO MISSING CONTEXT",
        },
        error:
          result.terminalTool === "error" ? result.args.reason : undefined,
      };
    }

    if (result.terminalTool === "send_message") {
      const target: string = result.args.to;
      const message: string = result.args.message;
      flowTurn.to = target;
      flowTurns.push(flowTurn);

      if (target === "output") {
        // Pipeline complete — return the best note
        logFinal(log, flowTurns, costs, mediaCost, startMs);

        if (!selectedNote) {
          return {
            post,
            botId,
            lastStage: "multi_agent_complete",
            searchContextResult: {
              text: content.text,
              searchResults: allSearchOutputs.join("\n\n"),
              citations: [],
            },
            noteResult: { note: "", url: "", status: "ERROR" },
            error: "Source verifier approved but no note was selected",
          };
        }

        return {
          post,
          botId,
          lastStage: "multi_agent_complete",
          searchContextResult: {
            text: content.text,
            searchResults: allSearchOutputs.join("\n\n"),
            citations: selectedNote.sources,
          },
          noteResult: {
            note: selectedNote.noteText,
            url: selectedNote.allUrls,
            status: "CORRECTION WITH TRUSTWORTHY CITATION",
          },
          checkResult: "YES",
        };
      }

      // Route to target agent
      if (target === "notewriter") {
        // Track researcher findings on first researcher → notewriter message
        if (currentAgentName === "researcher") {
          researcherFindings = message;
        }
        addUserMessage(
          agents.notewriter!,
          `Message from ${currentAgentName}:\n${message}`,
        );
        currentAgentName = "notewriter";
      } else if (target === "researcher") {
        addUserMessage(
          agents.researcher!,
          `Message from ${currentAgentName}:\n${message}`,
        );
        currentAgentName = "researcher";
      } else {
        // Unknown target — treat as error
        logFinal(log, flowTurns, costs, mediaCost, startMs);
        return {
          post,
          botId,
          lastStage: "multi_agent_complete",
          searchContextResult: {
            text: content.text,
            searchResults: allSearchOutputs.join("\n\n"),
            citations: [],
          },
          noteResult: { note: "", url: "", status: "ERROR" },
          error: `Unknown send_message target: ${target}`,
        };
      }

      continue;
    }

    if (result.terminalTool === "propose_notes") {
      // Notewriter proposed notes — evaluate and pick best
      const proposedNotes: Array<{ note_text: string; sources: string[] }> =
        result.args.notes ?? [];

      flowTurn.noteCount = proposedNotes.length;
      flowTurns.push(flowTurn);

      // Evaluate each note via X API in parallel
      const evalResults = await Promise.all(
        proposedNotes.map(async (n) => {
          const sources = (n.sources ?? []).filter(Boolean);
          const allUrls = sources.join(" ");
          const fullText = n.note_text + " " + allUrls;
          try {
            const evalResponse = await evaluateNote(post.id, fullText);
            return {
              noteText: n.note_text,
              sources,
              allUrls,
              score: evalResponse.data?.claim_opinion_score,
            };
          } catch (err: any) {
            return {
              noteText: n.note_text,
              sources,
              allUrls,
              score: undefined,
              error: err?.message,
            };
          }
        }),
      );

      // Log eval scores
      log?.set(
        `multiAgent.notewriter.turn.${agents.notewriter!.turnCount}.eval_scores`,
        evalResults.map((r, i) => ({
          index: i,
          score: r.score,
          error: (r as any).error,
        })),
      );

      // Pick highest-scoring note (fall back to first)
      const scored = evalResults.filter((r) => r.score != null);
      const best =
        scored.length > 0
          ? scored.reduce((a, b) => (b.score! > a.score! ? b : a))
          : evalResults[0];

      if (best) {
        selectedNote = {
          noteText: best.noteText,
          sources: best.sources,
          allUrls: best.allUrls,
          evalScore: best.score,
        };

        // Update flow turn with selection
        const lastFlow = flowTurns[flowTurns.length - 1]!;
        lastFlow.selectedIndex = evalResults.indexOf(best);
        lastFlow.evalScore = best.score;

        log?.set(
          `multiAgent.notewriter.turn.${agents.notewriter!.turnCount}.selectedIndex`,
          evalResults.indexOf(best),
        );
        log?.set(
          `multiAgent.notewriter.turn.${agents.notewriter!.turnCount}.selectedScore`,
          best.score,
        );
      }

      // Construct source verifier message
      const svMessage = [
        `## Selected community note`,
        `Note: ${selectedNote?.noteText ?? "(none)"}`,
        `Sources: ${selectedNote?.sources.join(", ") ?? "(none)"}`,
        `Evaluation score: ${selectedNote?.evalScore ?? "unknown"}`,
        ``,
        `## Research context`,
        researcherFindings,
      ].join("\n");

      addUserMessage(agents.source_verifier!, svMessage);
      currentAgentName = "source_verifier";
      continue;
    }

    // Unknown terminal tool
    flowTurns.push(flowTurn);
    break;
  }

  // Max turns exhausted — return whatever we have
  logFinal(log, flowTurns, costs, mediaCost, startMs);

  if (selectedNote) {
    return {
      post,
      botId,
      lastStage: "multi_agent_exhausted",
      searchContextResult: {
        text: content.text,
        searchResults: allSearchOutputs.join("\n\n"),
        citations: selectedNote.sources,
      },
      noteResult: {
        note: selectedNote.noteText,
        url: selectedNote.allUrls,
        status: "CORRECTION WITH TRUSTWORTHY CITATION",
      },
      checkResult: "YES",
      warnings: [`Multi-agent pipeline exhausted after ${MAX_TURNS} turns`],
    };
  }

  return {
    post,
    botId,
    lastStage: "multi_agent_exhausted",
    searchContextResult: {
      text: content.text,
      searchResults: allSearchOutputs.join("\n\n"),
      citations: [],
    },
    noteResult: { note: "", url: "", status: "ERROR" },
    error: `Multi-agent pipeline exhausted after ${MAX_TURNS} turns`,
  };
}

function logFinal(
  log: ReturnType<typeof getTweetLog>,
  flowTurns: FlowTurn[],
  costs: Record<string, TokenCost>,
  mediaCost: TokenCost | undefined,
  startMs: number,
): void {
  // Sum total costs
  const total = emptyTokenCost();
  for (const key of ["researcher", "notewriter", "sourceVerifier"] as const) {
    addTokenCost(total, costs[key]!);
  }
  if (mediaCost) addTokenCost(total, mediaCost);
  costs.total = total;

  log?.set("multiAgent.flow", {
    turns: flowTurns,
    totalTurns: flowTurns.length,
  });
  log?.set("multiAgent.costs", costs);
  log?.set("multiAgent.totalDurationMs", Date.now() - startMs);
}
