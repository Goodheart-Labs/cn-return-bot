/**
 * Multi-Agent Orchestrator
 *
 * Wires the researcher, notewriter, and source verifier together.
 * Manages turn routing, note evaluation, retry loops, and cost aggregation.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineResult, PostContent } from "../../bots/types";
import type { GeminiMediaResult } from "../media/mediaAnalysisGemini";
import type { AuthorNoteHistory } from "../input/authorHistory";
import type { BotConfig } from "../agent/agentConfig";
import { evaluateNote } from "../score/noteEvaluationFilter";
import { getTweetLog } from "../utils/tweetLog";
import {
  emptyTokenCost,
  addTokenCost,
  type TokenCost,
} from "../utils/pricing";
import {
  type AgentState,
  type TurnResult,
  initAgentState,
  addUserMessage,
  runAgentTurn,
} from "./agentFramework";
import type { IterationCost } from "../utils/pricing";
import { createResearcherDef, buildResearcherFirstMessage } from "./researcher";
import { createNotewriterDef } from "./notewriter";
import { createSourceVerifierDef } from "./sourceVerifier";

const MAX_TURNS = 10;

// --- Types ---

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

interface TurnCost extends TokenCost {
  messages: Record<number, IterationCost>;
}

interface AgentCostTree extends TokenCost {
  turn: Record<number, TurnCost>;
}

interface CostTree {
  researcher: AgentCostTree;
  notewriter: AgentCostTree;
  sourceVerifier: AgentCostTree;
  media: TokenCost;
  total: TokenCost;
}

interface PipelineState {
  post: Post;
  content: PostContent;
  agents: Record<string, AgentState>;
  flowTurns: FlowTurn[];
  allSearchOutputs: string[];
  selectedNote?: SelectedNote;
  researcherFindings: string;
  currentAgentName: string;
  costs: CostTree;
  startMs: number;
  mediaCost?: TokenCost;
}

// --- Pipeline init ---

function initPipeline(
  post: Post,
  content: PostContent,
  config: BotConfig,
  mediaResult: GeminiMediaResult,
  authorHistory?: AuthorNoteHistory,
  mediaCost?: TokenCost,
  comments?: string,
): PipelineState {
  const log = getTweetLog();

  // Build agent descriptions for system prompts
  const agentDefs = [
    { name: "researcher", desc: "Investigates factual claims in tweets using search tools and reports findings." },
    { name: "notewriter", desc: "Writes 3-4 community note variants based on research findings." },
    { name: "sourceVerifier", desc: "Verifies that cited sources support the community note correction." },
  ];
  const agentDescriptions = agentDefs.map((a) => `- ${a.name}: ${a.desc}`).join("\n");

  const researcherDef = createResearcherDef(config, agentDescriptions);
  const notewriterDef = createNotewriterDef(agentDescriptions, config.model);
  const sourceVerifierDef = createSourceVerifierDef(agentDescriptions, config.model);

  const agents: Record<string, AgentState> = {
    researcher: initAgentState(researcherDef),
    notewriter: initAgentState(notewriterDef),
    sourceVerifier: initAgentState(sourceVerifierDef),
  };

  // Log initial state
  log?.set("multiAgent.config", config);
  log?.set("multiAgent.agents", agentDefs);
  log?.set("inputs.author", {
    name: post.author_name,
    description: post.author_description,
    followers: post.author_followers,
    tweetCount: post.author_tweet_count,
    noteHistory: authorHistory ?? null,
  });

  // Build researcher's first user message
  const quotedRef = post.referenced_tweets?.find((rt) => rt.type === "quoted");
  const quotedPostText =
    quotedRef && post.referenced_tweet_data ? post.referenced_tweet_data.text : undefined;

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

  return {
    post,
    content,
    agents,
    flowTurns: [],
    allSearchOutputs: [],
    researcherFindings: "",
    currentAgentName: "researcher",
    costs: {
      researcher: { ...emptyTokenCost(), turn: {} },
      notewriter: { ...emptyTokenCost(), turn: {} },
      sourceVerifier: { ...emptyTokenCost(), turn: {} },
      media: mediaCost ?? emptyTokenCost(),
      total: emptyTokenCost(),
    },
    startMs: Date.now(),
    mediaCost,
  };
}

// --- Note evaluation ---

async function evaluateProposedNotes(
  state: PipelineState,
  result: TurnResult,
  flowTurn: FlowTurn,
): Promise<void> {
  const log = getTweetLog();
  const proposedNotes: Array<{ note_text: string; sources: string[] }> = result.args.notes ?? [];
  flowTurn.noteCount = proposedNotes.length;

  const evalResults = await Promise.all(
    proposedNotes.map(async (n) => {
      const sources = (n.sources ?? []).filter(Boolean);
      const allUrls = sources.join(" ");
      const fullText = n.note_text + " " + allUrls;
      try {
        const evalResponse = await evaluateNote(state.post.id, fullText);
        return { noteText: n.note_text, sources, allUrls, score: evalResponse.data?.claim_opinion_score };
      } catch (err: any) {
        return { noteText: n.note_text, sources, allUrls, score: undefined, error: err?.message };
      }
    }),
  );

  const notewriterTurn = state.agents.notewriter!.turnCount;
  log?.set(
    `multiAgent.notewriter.turn.${notewriterTurn}.eval_scores`,
    evalResults.map((r, i) => ({ index: i, score: r.score, error: (r as any).error })),
  );

  // Pick highest-scoring note (fall back to first)
  const scored = evalResults.filter((r) => r.score != null);
  const best = scored.length > 0
    ? scored.reduce((a, b) => (b.score! > a.score! ? b : a))
    : evalResults[0];

  if (best) {
    state.selectedNote = {
      noteText: best.noteText,
      sources: best.sources,
      allUrls: best.allUrls,
      evalScore: best.score,
    };
    flowTurn.selectedIndex = evalResults.indexOf(best);
    flowTurn.evalScore = best.score;
    log?.set(`multiAgent.notewriter.turn.${notewriterTurn}.selectedIndex`, evalResults.indexOf(best));
    log?.set(`multiAgent.notewriter.turn.${notewriterTurn}.selectedScore`, best.score);
  }

  // Route to source verifier
  const svMessage = [
    `## Selected community note`,
    `Note: ${state.selectedNote?.noteText ?? "(none)"}`,
    `Sources: ${state.selectedNote?.sources.join(", ") ?? "(none)"}`,
    `Evaluation score: ${state.selectedNote?.evalScore ?? "unknown"}`,
    ``,
    `## Research context`,
    state.researcherFindings,
  ].join("\n");

  addUserMessage(state.agents.sourceVerifier!, svMessage);
  state.currentAgentName = "sourceVerifier";
}

// --- send_message routing ---

type RouteResult = "routed" | "error";

function routeSendMessage(
  state: PipelineState,
  target: string,
  message: string,
  senderName: string,
): RouteResult {
  const targetAgent = state.agents[target];
  if (!targetAgent) return "error";

  if (target === "notewriter" && senderName === "researcher") {
    state.researcherFindings = message;
  }

  addUserMessage(targetAgent, `Message from ${senderName}:\n${message}`);
  state.currentAgentName = target;
  return "routed";
}

// --- PipelineResult builders ---

function buildResult(
  state: PipelineState,
  lastStage: string,
  note?: SelectedNote,
  error?: string,
  warnings?: string[],
): PipelineResult {
  const searchResults = state.allSearchOutputs.join("\n\n");

  if (note) {
    return {
      post: state.post,
      botId: "multi-agent",
      lastStage,
      searchContextResult: { text: state.content.text, searchResults, citations: note.sources },
      noteResult: { note: note.noteText, url: note.allUrls, status: "CORRECTION WITH TRUSTWORTHY CITATION" },
      checkResult: "YES",
      warnings,
    };
  }

  return {
    post: state.post,
    botId: "multi-agent",
    lastStage,
    searchContextResult: { text: state.content.text, searchResults, citations: [] },
    noteResult: { note: "", url: "", status: error ? "ERROR" : "NO MISSING CONTEXT" },
    error,
    warnings,
  };
}

// --- Cost logging ---

function logFinal(state: PipelineState): void {
  const total = emptyTokenCost();
  for (const key of ["researcher", "notewriter", "sourceVerifier"] as const) {
    addTokenCost(total, state.costs[key]);
  }
  if (state.mediaCost) addTokenCost(total, state.mediaCost);
  state.costs.total = total;

  const log = getTweetLog();
  log?.set("multiAgent.flow", { turns: state.flowTurns, totalTurns: state.flowTurns.length });
  log?.set("multiAgent.costs", state.costs);
  log?.set("multiAgent.totalDurationMs", Date.now() - state.startMs);
}

// --- Main pipeline ---

export async function runMultiAgentPipeline(
  post: Post,
  content: PostContent,
  config: BotConfig,
  mediaResult: GeminiMediaResult,
  authorHistory?: AuthorNoteHistory,
  mediaCost?: TokenCost,
  comments?: string,
): Promise<PipelineResult> {
  const state = initPipeline(post, content, config, mediaResult, authorHistory, mediaCost, comments);
  let turnCount = 0;

  while (turnCount < MAX_TURNS) {
    turnCount++;
    const turnStartMs = Date.now();
    const result = await runAgentTurn(state.agents[state.currentAgentName]!);
    const turnDurationMs = Date.now() - turnStartMs;

    state.allSearchOutputs.push(...result.searchOutputs);

    // Accumulate cost into the tree
    const agentCost = state.costs[state.currentAgentName as keyof CostTree] as AgentCostTree;
    const turnNum = state.agents[state.currentAgentName]!.turnCount;
    agentCost.turn[turnNum] = { messages: result.iterationCosts, ...result.cost };
    addTokenCost(agentCost, result.cost);

    const flowTurn: FlowTurn = {
      agent: state.currentAgentName,
      terminalTool: result.terminalTool,
      durationMs: turnDurationMs,
    };

    // --- no_correction_needed / error ---
    if (result.terminalTool === "no_correction_needed" || result.terminalTool === "error") {
      state.flowTurns.push(flowTurn);
      logFinal(state);
      const status = result.terminalTool === "error" ? "ERROR" : undefined;
      return buildResult(state, "multi_agent_complete", undefined, status ? result.args.reason : undefined);
    }

    // --- approve_note (source verifier approved with verified sources) ---
    if (result.terminalTool === "approve_note") {
      state.flowTurns.push(flowTurn);
      logFinal(state);

      if (!state.selectedNote) {
        return buildResult(state, "multi_agent_complete", undefined, "Source verifier approved but no note was selected");
      }

      // Use the verified source subset from the source verifier
      const verifiedSources: string[] = result.args.sources ?? state.selectedNote.sources;
      state.selectedNote = {
        ...state.selectedNote,
        sources: verifiedSources,
        allUrls: verifiedSources.join(" "),
      };

      return buildResult(state, "multi_agent_complete", state.selectedNote);
    }

    // --- send_message ---
    if (result.terminalTool === "send_message") {
      flowTurn.to = result.args.to;
      state.flowTurns.push(flowTurn);

      const route = routeSendMessage(state, result.args.to, result.args.message, state.currentAgentName);

      if (route === "error") {
        logFinal(state);
        return buildResult(state, "multi_agent_complete", undefined, `Unknown send_message target: ${result.args.to}`);
      }
      continue;
    }

    // --- propose_notes ---
    if (result.terminalTool === "propose_notes") {
      await evaluateProposedNotes(state, result, flowTurn);
      state.flowTurns.push(flowTurn);
      continue;
    }

    // Unknown terminal tool
    state.flowTurns.push(flowTurn);
    break;
  }

  // Max turns exhausted
  logFinal(state);
  if (state.selectedNote) {
    return buildResult(state, "multi_agent_exhausted", state.selectedNote, undefined, [
      `Multi-agent pipeline exhausted after ${MAX_TURNS} turns`,
    ]);
  }
  return buildResult(state, "multi_agent_exhausted", undefined, `Multi-agent pipeline exhausted after ${MAX_TURNS} turns`);
}
