/**
 * Multi-Agent Orchestrator
 *
 * Wires the researcher, notewriter, and source verifier together.
 * Manages turn routing, note evaluation, and retry loops.
 * Costs tracked via CostTracker ALS.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { PostContent, PipelineOutcome } from "../../bots/types";
import type { BotInput } from "../input/createBotInput";
import { getBotConfig } from "../utils/botConfig";
import { getTweetLog } from "../utils/tweetLog";
import { type AgentState, initAgentState, addUserMessage, runAgentTurn } from "../tool-calling/agentLoop";
import { evaluateAndPickBest, type EvaluatedNote } from "../score/noteEvaluation";
import { aggregateAndLogCosts } from "../utils/costTracker";
import { createResearcherDef } from "./researcher";
import { buildUserMessage } from "../input/prompt";
import { createNotewriterDef } from "./notewriter";
import { createSourceVerifierDef } from "./sourceVerifier";

const MAX_TURNS = 10;

interface PipelineState {
  post: Post;
  agents: Record<string, AgentState>;
  selectedNote?: EvaluatedNote;
  researcherFindings: string;
  currentAgentName: string;
}

function initPipeline(post: Post, content: PostContent, input: BotInput): PipelineState {
  const config = getBotConfig();
  const log = getTweetLog();

  const defs = [createResearcherDef(), createNotewriterDef(), createSourceVerifierDef()];
  const agentDescriptions = defs.map((d) => `- ${d.name}: ${d.description}`).join("\n");
  for (const def of defs) {
    def.systemPrompt += `\n\n## Other agents\n${agentDescriptions}`;
  }

  const agents: Record<string, AgentState> = Object.fromEntries(
    defs.map((def) => [def.name, initAgentState(def)]),
  );

  log?.set("multiAgent.config", config);
  log?.set("multiAgent.agents", defs.map((d) => ({ name: d.name, desc: d.description })));

  const firstMessage = buildUserMessage({
    post,
    tweetText: content.text,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
    comments: input.comments,
  });
  addUserMessage(agents.researcher!, firstMessage);

  return { post, agents, researcherFindings: "", currentAgentName: "researcher" };
}

async function handleProposeNotes(
  state: PipelineState,
  notes: Array<{ note_text: string; sources: string[] }>,
): Promise<void> {
  const log = getTweetLog();
  const { selected, evalResults } = await evaluateAndPickBest(state.post.id, notes);

  const turnNum = state.agents.notewriter!.turnCount;
  log?.set(`multiAgent.notewriter.turn.${turnNum}.eval_scores`,
    evalResults.map((r, i) => ({ index: i, score: r.evalScore, error: r.error })));

  state.selectedNote = selected;
  log?.set(`multiAgent.notewriter.turn.${turnNum}.selectedIndex`, evalResults.indexOf(selected as any));
  log?.set(`multiAgent.notewriter.turn.${turnNum}.selectedScore`, selected.evalScore);

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

function routeSendMessage(state: PipelineState, target: string, message: string, senderName: string): boolean {
  const targetAgent = state.agents[target];
  if (!targetAgent) return false;

  if (target === "notewriter" && senderName === "researcher") {
    state.researcherFindings = message;
  }

  addUserMessage(targetAgent, `Message from ${senderName}:\n${message}`);
  state.currentAgentName = target;
  return true;
}

export async function runMultiAgentPipeline(
  post: Post,
  content: PostContent,
  input: BotInput,
): Promise<PipelineOutcome> {
  const startMs = Date.now();
  const state = initPipeline(post, content, input);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const agentName = state.currentAgentName;
    const logPrefix = `multiAgent.${agentName}.turn.${state.agents[agentName]!.turnCount + 1}.messages`;
    const result = await runAgentTurn(state.agents[agentName]!, logPrefix);

    if (result.terminalTool === "no_correction_needed") {
      logFinal(startMs);
      return { type: "no_correction", reason: result.args.reason ?? "No correction needed" };
    }

    if (result.terminalTool === "error") {
      logFinal(startMs);
      return { type: "error", error: result.args.reason ?? "Agent error" };
    }

    if (result.terminalTool === "approve_note") {
      logFinal(startMs);
      if (!state.selectedNote) {
        return { type: "error", error: "Source verifier approved but no note was selected" };
      }
      const verifiedSources: string[] = result.args.sources ?? state.selectedNote.sources;
      return { type: "note", noteText: state.selectedNote.noteText, sources: verifiedSources, evalScore: state.selectedNote.evalScore };
    }

    if (result.terminalTool === "send_message") {
      if (!routeSendMessage(state, result.args.to, result.args.message, agentName)) {
        logFinal(startMs);
        return { type: "error", error: `Unknown send_message target: ${result.args.to}` };
      }
      continue;
    }

    if (result.terminalTool === "propose_notes") {
      await handleProposeNotes(state, result.args.notes ?? []);
      continue;
    }

    break;
  }

  logFinal(startMs);
  if (state.selectedNote) {
    return { type: "note", noteText: state.selectedNote.noteText, sources: state.selectedNote.sources, evalScore: state.selectedNote.evalScore };
  }
  return { type: "error", error: `Multi-agent pipeline exhausted after ${MAX_TURNS} turns` };
}

function logFinal(startMs: number): void {
  const log = getTweetLog();
  log?.set("multiAgent.totalDurationMs", Date.now() - startMs);
  aggregateAndLogCosts("multiAgent");
}
