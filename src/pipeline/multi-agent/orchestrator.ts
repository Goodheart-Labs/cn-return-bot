/**
 * Multi-Agent Orchestrator
 *
 * Wires the researcher, notewriter, and source verifier together.
 * Manages turn routing, note evaluation, retry loops, and cost aggregation.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PipelineResult, PostContent } from "../../bots/types";
import type { BotInput } from "../input/createBotInput";
import { getBotConfig } from "../utils/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { emptyTokenCost, emptyAgentCostTree, addTokenCost, type TokenCost, type AgentCostTree } from "../utils/pricing";
import { type AgentState, type TurnResult, initAgentState, addUserMessage, runAgentTurn } from "../tool-calling/agentLoop";
import { evaluateAndPickBest, type EvaluatedNote } from "../score/noteEvaluation";
import { buildNoteResult, buildEmptyResult } from "../utils/pipelineResult";
import { createResearcherDef } from "./researcher";
import { buildUserMessage } from "../input/prompt";
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
  selectedNote?: EvaluatedNote;
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
  input: BotInput,
): PipelineState {
  const config = getBotConfig();
  const log = getTweetLog();

  const agentDefs = [
    { name: "researcher", desc: "Investigates factual claims in tweets using search tools and reports findings." },
    { name: "notewriter", desc: "Writes 3-4 community note variants based on research findings." },
    { name: "sourceVerifier", desc: "Verifies that cited sources support the community note correction." },
  ];
  const agentDescriptions = agentDefs.map((a) => `- ${a.name}: ${a.desc}`).join("\n");

  const agents: Record<string, AgentState> = {
    researcher: initAgentState(createResearcherDef(agentDescriptions)),
    notewriter: initAgentState(createNotewriterDef(agentDescriptions)),
    sourceVerifier: initAgentState(createSourceVerifierDef(agentDescriptions)),
  };

  log?.set("multiAgent.config", config);
  log?.set("multiAgent.agents", agentDefs);

  const firstMessage = buildUserMessage({
    post,
    tweetText: content.text,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
    comments: input.comments,
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
      researcher: emptyAgentCostTree(),
      notewriter: emptyAgentCostTree(),
      sourceVerifier: emptyAgentCostTree(),
      media: input.mediaCost ?? emptyTokenCost(),
      total: emptyTokenCost(),
    },
    startMs: Date.now(),
    mediaCost: input.mediaCost,
  };
}

// --- Note evaluation ---

async function handleProposeNotes(
  state: PipelineState,
  result: TurnResult,
  flowTurn: FlowTurn,
): Promise<void> {
  const log = getTweetLog();
  const notes: Array<{ note_text: string; sources: string[] }> = result.args.notes ?? [];
  flowTurn.noteCount = notes.length;

  const { selected, evalResults } = await evaluateAndPickBest(state.post.id, notes);

  const turnNum = state.agents.notewriter!.turnCount;
  log?.set(`multiAgent.notewriter.turn.${turnNum}.eval_scores`,
    evalResults.map((r, i) => ({ index: i, score: r.evalScore, error: r.error })));

  state.selectedNote = selected;
  flowTurn.selectedIndex = evalResults.indexOf(selected as any);
  flowTurn.evalScore = selected.evalScore;
  log?.set(`multiAgent.notewriter.turn.${turnNum}.selectedIndex`, flowTurn.selectedIndex);
  log?.set(`multiAgent.notewriter.turn.${turnNum}.selectedScore`, selected.evalScore);

  // Route to source verifier
  const svMessage = [
    `## Selected community note`,
    `Note: ${selected.noteText}`,
    `Sources: ${selected.sources.join(", ")}`,
    `Evaluation score: ${selected.evalScore ?? "unknown"}`,
    ``,
    `## Research context`,
    state.researcherFindings,
  ].join("\n");

  addUserMessage(state.agents.sourceVerifier!, svMessage);
  state.currentAgentName = "sourceVerifier";
}

// --- send_message routing ---

function routeSendMessage(
  state: PipelineState,
  target: string,
  message: string,
  senderName: string,
): boolean {
  const targetAgent = state.agents[target];
  if (!targetAgent) return false;

  if (target === "notewriter" && senderName === "researcher") {
    state.researcherFindings = message;
  }

  addUserMessage(targetAgent, `Message from ${senderName}:\n${message}`);
  state.currentAgentName = target;
  return true;
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
  input: BotInput,
): Promise<PipelineResult> {
  const state = initPipeline(post, content, input);
  const searchResults = () => state.allSearchOutputs.join("\n\n");
  const common = () => ({ post, botId: "multi-agent", text: content.text, searchResults: searchResults() });
  let turnCount = 0;

  while (turnCount < MAX_TURNS) {
    turnCount++;
    const turnStartMs = Date.now();
    const agentName = state.currentAgentName;
    const logPrefix = `multiAgent.${agentName}.turn.${state.agents[agentName]!.turnCount + 1}.messages`;
    const result = await runAgentTurn(state.agents[agentName]!, logPrefix);
    const turnDurationMs = Date.now() - turnStartMs;

    state.allSearchOutputs.push(...result.searchOutputs);

    // Accumulate cost
    const agentCost = state.costs[agentName as keyof CostTree] as AgentCostTree;
    const turnNum = state.agents[agentName]!.turnCount;
    agentCost.turn[turnNum] = { messages: result.iterationCosts, ...result.cost };
    addTokenCost(agentCost, result.cost);

    const flowTurn: FlowTurn = { agent: agentName, terminalTool: result.terminalTool, durationMs: turnDurationMs };

    if (result.terminalTool === "no_correction_needed" || result.terminalTool === "error") {
      state.flowTurns.push(flowTurn);
      logFinal(state);
      return buildEmptyResult({
        ...common(),
        lastStage: "multi_agent_complete",
        error: result.terminalTool === "error" ? result.args.reason : undefined,
      });
    }

    if (result.terminalTool === "approve_note") {
      state.flowTurns.push(flowTurn);
      logFinal(state);
      if (!state.selectedNote) {
        return buildEmptyResult({ ...common(), lastStage: "multi_agent_complete", error: "Source verifier approved but no note was selected" });
      }
      const verifiedSources: string[] = result.args.sources ?? state.selectedNote.sources;
      return buildNoteResult({
        ...common(),
        lastStage: "multi_agent_complete",
        noteText: state.selectedNote.noteText,
        sources: verifiedSources,
        allUrls: verifiedSources.join(" "),
      });
    }

    if (result.terminalTool === "send_message") {
      flowTurn.to = result.args.to;
      state.flowTurns.push(flowTurn);
      if (!routeSendMessage(state, result.args.to, result.args.message, agentName)) {
        logFinal(state);
        return buildEmptyResult({ ...common(), lastStage: "multi_agent_complete", error: `Unknown send_message target: ${result.args.to}` });
      }
      continue;
    }

    if (result.terminalTool === "propose_notes") {
      await handleProposeNotes(state, result, flowTurn);
      state.flowTurns.push(flowTurn);
      continue;
    }

    state.flowTurns.push(flowTurn);
    break;
  }

  logFinal(state);
  if (state.selectedNote) {
    return buildNoteResult({
      ...common(),
      lastStage: "multi_agent_exhausted",
      ...state.selectedNote,
      warnings: [`Multi-agent pipeline exhausted after ${MAX_TURNS} turns`],
    });
  }
  return buildEmptyResult({ ...common(), lastStage: "multi_agent_exhausted", error: `Multi-agent pipeline exhausted after ${MAX_TURNS} turns` });
}
