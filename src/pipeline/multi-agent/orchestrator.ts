/**
 * Multi-Agent Orchestrator
 *
 * Wires researcher → note-needed judge → notewriter → fact verification.
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
import { verifySources } from "../verify/sourceVerifier";
import { createResearcherDef } from "./researcher";
import { buildUserMessage } from "../input/prompt";
import { createNotewriterDef } from "./notewriter";
import { judgeNoteNeeded } from "./noteNeededJudge";

const MAX_TURNS = 10;
const MAX_SOURCE_VERIFICATION_ATTEMPTS = 2;
const MAX_RESEARCHER_MESSAGES = 20;

interface PipelineState {
  post: Post;
  postText: string;
  postUserMessage: string;
  agents: Record<string, AgentState>;
  selectedNote?: EvaluatedNote;
  researcherFindings: string;
  currentAgentName: string;
  sourceVerifierTurnCount: number;
}

function initPipeline(post: Post, content: PostContent, input: BotInput): PipelineState {
  const config = getBotConfig();
  const log = getTweetLog();

  const defs = [createResearcherDef(), createNotewriterDef()];
  const agents: Record<string, AgentState> = Object.fromEntries(
    defs.map((def) => [def.name, initAgentState(def)]),
  );

  log?.set("multiAgent.config", config);
  log?.set("multiAgent.agents", defs.map((d) => ({ name: d.name, desc: d.description })));

  const postUserMessage = buildUserMessage({
    post,
    tweetText: content.text,
    tweetMedia: input.mediaResult.tweetMedia,
    quotedTweetMedia: input.mediaResult.quotedTweetMedia,
    authorNoteHistory: input.authorHistory,
    comments: input.comments,
  });
  addUserMessage(agents.researcher!, postUserMessage);

  return {
    post,
    postText: content.text,
    postUserMessage,
    agents,
    researcherFindings: "",
    currentAgentName: "researcher",
    sourceVerifierTurnCount: 0,
  };
}

type VerificationResult =
  | { type: "accepted"; note: EvaluatedNote }
  | { type: "rejected"; reasoning: string };

async function handleProposeNotes(
  state: PipelineState,
  notes: Array<{ note_text: string; sources: string[] }>,
): Promise<VerificationResult> {
  const log = getTweetLog();
  const { selected, evalResults } = await evaluateAndPickBest(state.post.id, notes);

  const turnNum = state.agents.notewriter!.turnCount;
  log?.set(`multiAgent.notewriter.turn.${turnNum}.eval_scores`,
    evalResults.map((r, i) => ({ index: i, score: r.evalScore, error: r.error })));

  state.selectedNote = selected;
  log?.set(`multiAgent.notewriter.turn.${turnNum}.selectedIndex`, evalResults.indexOf(selected as any));
  log?.set(`multiAgent.notewriter.turn.${turnNum}.selectedScore`, selected.evalScore);

  state.sourceVerifierTurnCount++;
  const verification = await verifySources({
    noteText: selected.noteText,
    sources: selected.sources,
    postText: state.postText,
    researcherFindings: state.researcherFindings,
    turnNumber: state.sourceVerifierTurnCount,
  });

  if (verification.accepted) {
    return { type: "accepted", note: selected };
  }
  return { type: "rejected", reasoning: verification.reasoning };
}

function resetNotewriter(state: PipelineState): void {
  const nw = state.agents.notewriter!;
  nw.messages = [{ role: "system", content: nw.def.systemPrompt }];
}

function handOffToNotewriter(state: PipelineState): void {
  resetNotewriter(state);
  addUserMessage(
    state.agents.notewriter!,
    `## Original post\n${state.postUserMessage}\n\n## Researcher findings\n${state.researcherFindings}`,
  );
  state.currentAgentName = "notewriter";
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

    if (
      agentName === "researcher" &&
      state.agents.researcher!.messages.length >= MAX_RESEARCHER_MESSAGES
    ) {
      logFinal(startMs);
      return {
        type: "no_correction",
        reason: `Researcher exceeded ${MAX_RESEARCHER_MESSAGES} messages without producing findings`,
      };
    }

    const logPrefix = `multiAgent.${agentName}.turn.${state.agents[agentName]!.turnCount + 1}.messages`;
    const result = await runAgentTurn(state.agents[agentName]!, logPrefix);

    if (result.terminalTool === "error") {
      logFinal(startMs);
      return { type: "error", error: result.args.reason ?? "Agent error" };
    }

    if (result.terminalTool === "text_response") {
      if (agentName === "researcher") {
        const findings = result.args.content ?? "";
        if (!findings.trim()) {
          logFinal(startMs);
          return { type: "no_correction", reason: "Researcher produced no findings" };
        }
        state.researcherFindings = findings;

        const decision = await judgeNoteNeeded({
          postUserMessage: state.postUserMessage,
          researcherFindings: findings,
        });

        if (!decision.needed) {
          logFinal(startMs);
          return { type: "no_correction", reason: decision.reason };
        }

        handOffToNotewriter(state);
        continue;
      }
      logFinal(startMs);
      return { type: "no_correction", reason: result.args.content ?? "No correction needed" };
    }

    if (result.terminalTool === "propose_notes") {
      const verification = await handleProposeNotes(state, result.args.notes ?? []);

      if (verification.type === "accepted") {
        logFinal(startMs);
        return {
          type: "note",
          noteText: verification.note.noteText,
          sources: verification.note.sources,
          evalScore: verification.note.evalScore,
        };
      }

      // Give researcher one retry, then give up
      if (state.sourceVerifierTurnCount >= MAX_SOURCE_VERIFICATION_ATTEMPTS) {
        logFinal(startMs);
        return { type: "no_correction", reason: `Source verification rejected: ${verification.reasoning}` };
      }

      const feedback = [
        `The proposed note was rejected by fact verification.`,
        ``,
        `Rejected note: ${state.selectedNote!.noteText}`,
        `Sources: ${state.selectedNote!.sources.join(", ")}`,
        `Rejection reason: ${verification.reasoning}`,
        ``,
        `Now you have more information. You have one more chance to do research and send your updated findings.`,
      ].join("\n");

      addUserMessage(state.agents.researcher!, feedback);
      resetNotewriter(state);
      state.currentAgentName = "researcher";
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
