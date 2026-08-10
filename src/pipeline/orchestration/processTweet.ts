/**
 * Process Single Tweet
 *
 * This file holds the per-tweet pipeline logic. It used to live in
 * generateCandidates.ts. The work is split into three layers.
 *   1. runBotPipeline() runs the bot and returns its raw output.
 *   2. scorePipelineResult() computes the scores, including X's evaluation score.
 *   3. determineOutcome() is a pure function. It decides the outcome from the
 *      pipeline result and the scores.
 *
 * processSingleTweet() is the thin orchestrator that glues the three together.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import type { Bot, PipelineResult, PostContent } from "../../bots/types";
import { runMaterialityJudge } from "./materialityJudge";
import { getOriginalTweetContent } from "../../utils/retweetUtils";
import { getEvaluationScore } from "../score/noteEvaluationFilter";
import { getTweetLog, getLoggedBotIdentity, nestDotKeys } from "../utils/tweetLog";
import { getWarnings } from "../utils/warnings";
import { PipelineError } from "../utils/errors";
import { aggregateAndLogCosts } from "../cost-tracking/costTracker";
import { countNoteLength, joinNoteAndUrl } from "../utils/noteLength";
import { getBotConfig } from "../ab-testing/botConfig";
import { getMonitoringContext } from "../misinfo-monitoring/monitoringContext";
import { runNoteNeededPrefilter } from "../prefilter/noteNeededPrefilter";
import { runBlockedTopicFilter } from "../prefilter/blockedTopicFilter";
import { createBotInput } from "../input/createBotInput";
import { buildUserMessageFromInput } from "../prompts/input/userMessage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessTweetOptions {
  post: Post;
  bot: Bot;
  logger: SupabaseLogger | null;
  commitSha?: string;
}

export interface ScoreEntry {
  type: string;
  value?: number;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface BotPipelineOutput {
  result: PipelineResult | null;
  content: PostContent;
}

export interface Outcome {
  outcome: "candidate" | "rejected" | "failed";
  outcomeReason?: string;
  finalStage: string;
  errorMessage?: string;
}

export interface ProcessTweetResult {
  pipelineResult: PipelineResult | null;
  outcome: "candidate" | "rejected" | "failed";
  outcomeReason?: string;
  finalStage: string;
  noteStatus?: string;
  evaluationScore?: number;
  noteText?: string;
  scores: ScoreEntry[];
  pipelineRunId: string | null;
}

// ---------------------------------------------------------------------------
// Layer 1: Run the bot pipeline. No database writes and no scoring.
// ---------------------------------------------------------------------------

async function runBotPipeline(
  post: Post,
  bot: Bot
): Promise<BotPipelineOutput> {
  const content = getOriginalTweetContent(post);
  const hasVideo = !!post.media?.some((m) => m.type === "video");

  const tweetType = `${content.isQuoteTweet ? "quote tweet" : "original"}${hasVideo ? " [VIDEO]" : ""}`;

  const log = getTweetLog();
  log?.set("tweet.post", post);
  log?.set("tweet.type", tweetType);
  log?.set("bot.id", bot.id);

  if (post.created_at) {
    const ageMs = Date.now() - new Date(post.created_at).getTime();
    log?.set("tweet.recencyHours", Math.max(0, ageMs / (1000 * 60 * 60)));
  }

  const result = await bot.runPipeline(post, content);

  return { result, content };
}

/** Returns the non-fatal warnings collected during this run. One example is the
 *  media analysis falling back to Haiku. The warnings are also copied into the
 *  tweet log so they show up in the logs dump. The return value is undefined
 *  when there were none, which is what the pipeline_runs.warnings column
 *  expects. */
function collectWarnings(): string[] | undefined {
  const warnings = getWarnings();
  if (!warnings.length) return undefined;
  getTweetLog()?.set("warnings", warnings);
  return warnings;
}

// ---------------------------------------------------------------------------
// Layer 2: Score the pipeline result. No outcome decisions are made here.
// ---------------------------------------------------------------------------

interface EvalGateDecision {
  threshold: number;
  score?: number;
  shouldSubmit?: boolean;
  error?: string;
  /** When this is true we still record the score, but it never vetoes a
   *  submission. We set it for misinfo-monitoring posts. We curate those topics
   *  by hand, so we keep the evaluation score for visibility and let our note
   *  through whatever the score says. */
  advisory?: boolean;
}

interface ScoringOutput {
  scores: ScoreEntry[];
  evalGate: EvalGateDecision;
}

function extractSourceVerificationScore(result: PipelineResult): ScoreEntry | null {
  if (result.checkResult == null) return null;
  const checkRaw = result.checkResult.trim().toUpperCase();
  return {
    type: "source_verification",
    value: checkRaw === "YES" ? 1 : 0,
    label: checkRaw,
  };
}

function extractBotScoringFilterScores(result: PipelineResult): ScoreEntry[] {
  const scoringResults = (result as any).scoringResults;
  if (!scoringResults) return [];

  const SCORE_KEY_MAP: Record<string, string> = {
    positive: "positive_claims",
    disagreement: "disagreement",
    helpfulness: "helpfulness",
  };

  const entries: ScoreEntry[] = [];
  for (const [key, scoreType] of Object.entries(SCORE_KEY_MAP)) {
    const sr = scoringResults[key];
    if (sr) {
      entries.push({
        type: scoreType,
        value: sr.score,
        metadata: { reasoning: sr.reasoning },
      });
    }
  }
  return entries;
}

async function scorePipelineResult(
  result: PipelineResult
): Promise<ScoringOutput> {
  const scores: ScoreEntry[] = [];
  const noteText = joinNoteAndUrl(result.noteResult.note, result.noteResult.url);
  const evalGate: EvalGateDecision = {
    threshold: getBotConfig().eval_submit_threshold ?? 0,
    advisory: getMonitoringContext() !== undefined,
  };
  const log = getTweetLog();
  log?.set("eval.threshold", evalGate.threshold);
  log?.set("eval.advisory", evalGate.advisory);

  const svScore = extractSourceVerificationScore(result);
  if (svScore) scores.push(svScore);

  scores.push(...extractBotScoringFilterScores(result));

  // The materiality judge is a shadow scorer. We log what it says and gate
  // nothing on it. It only runs when the bot actually wrote a correction,
  // because an empty note has nothing to judge. A judge failure must never stop
  // the run, so we swallow the error and continue.
  if (result.noteResult.status === CORRECTION_STATUS && result.noteResult.note) {
    try {
      const materialityScores = await runMaterialityJudge({
        postText: String(result.post?.text ?? ""),
        findings: result.searchContextResult?.searchResults ?? "",
        noteText,
      });
      scores.push(...materialityScores);
      const overall = materialityScores.find((s) => s.type === "materiality_overall");
      log?.set("materiality.overall", overall?.value);
    } catch (err) {
      log?.set("materiality.error", String(err).slice(0, 200));
      console.warn("[materiality] judge failed (shadow — continuing):", err);
    }
  }

  const evalResult = await getEvaluationScore(result.post.id, noteText);
  if (evalResult.error) {
    evalGate.error = evalResult.error;
    log?.set("eval.error", evalResult.error);
  }
  if (evalResult.score !== undefined) {
    evalGate.score = evalResult.score;
    evalGate.shouldSubmit = evalResult.score >= evalGate.threshold;
    log?.set("eval.shouldSubmit", evalGate.shouldSubmit);
    scores.push({
      type: "evaluation",
      value: evalResult.score,
      metadata: { threshold: evalGate.threshold, passed: evalGate.shouldSubmit },
    });
  }

  return { scores, evalGate };
}

// ---------------------------------------------------------------------------
// Layer 3: Determine the outcome. This layer is pure and has no side effects.
// ---------------------------------------------------------------------------

const STATUS_REJECTION_MAP: Record<string, { reason: string; stage: string }> = {
  SCORING_FILTERS_FAILED: { reason: "scoring_filters_failed", stage: "scoring" },
  SOURCE_TRUST_FAILED: { reason: "source_trust_failed", stage: "source_trust" },
};

const CORRECTION_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION";

function determineOutcome(result: PipelineResult, scoring: ScoringOutput): Outcome {
  const statusRejection = STATUS_REJECTION_MAP[result.noteResult.status];
  if (statusRejection) {
    return { outcome: "rejected", outcomeReason: statusRejection.reason, finalStage: statusRejection.stage };
  }

  if (result.noteResult.status !== CORRECTION_STATUS) {
    return { outcome: "rejected", outcomeReason: "no_correction_needed", finalStage: "note_writing" };
  }

  // The source verifier is allowed to be skipped entirely. A missing checkResult
  // therefore counts as a pass, not as a failure.
  const checkRaw = result.checkResult?.trim().toUpperCase() ?? "";
  const checkSkipped = result.checkResult == null;
  const checkPassed = checkSkipped || checkRaw === "YES";
  const checkErrored = checkRaw.startsWith("ERROR");

  if (!checkPassed) {
    return {
      outcome: checkErrored ? "failed" : "rejected",
      outcomeReason: checkErrored ? "check_error" : "check_failed",
      finalStage: "check",
      errorMessage: checkRaw ? `check: ${checkRaw}` : undefined,
    };
  }

  // This gate rejects a note whose evaluation score is below the threshold. If
  // the evaluation call failed or returned no number, shouldSubmit stays
  // undefined and we skip the gate rather than reject a note that may be good.
  // On advisory posts, which are the misinfo-monitoring ones, the score is
  // recorded but never rejects anything.
  if (scoring.evalGate.shouldSubmit === false && !scoring.evalGate.advisory) {
    const { score, threshold } = scoring.evalGate;
    return {
      outcome: "rejected",
      outcomeReason: "low_evaluation_score",
      finalStage: "evaluation",
      errorMessage: score !== undefined ? `eval score ${score} below threshold ${threshold}` : undefined,
    };
  }

  return { outcome: "candidate", finalStage: "candidate" };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function logScoresToDb(
  logger: SupabaseLogger | null,
  runId: string | null,
  scores: ScoreEntry[]
): Promise<void> {
  if (!logger || !runId) return;
  const promises = scores.map((s) =>
    logger.addPipelineScore(runId, {
      score_type: s.type,
      score_value: s.value,
      score_label: s.label,
      score_metadata: s.metadata,
    }).catch((err) => console.warn(`[processTweet] Failed to log score ${s.type}:`, err))
  );
  await Promise.all(promises);
}

async function initPipelineRun(
  logger: SupabaseLogger,
  post: Post,
  commitSha?: string
): Promise<string | null> {
  // The tweets row is already written in bulk when the posts are fetched. See
  // fetchPosts in generateCandidates.ts. So there is nothing to insert here.
  try {
    return await logger.createPipelineRun({
      tweet_id: post.id,
      commit_sha: commitSha,
    });
  } catch (err) {
    console.warn(`[processTweet] Failed to create pipeline run for ${post.id}:`, err);
    return null;
  }
}

function buildSuccessCompletionData(
  result: PipelineResult,
  bot: { name: string; picks?: Record<string, string>; config?: Record<string, unknown> },
  outcome: Outcome,
  warnings: string[] | undefined,
  logs: Record<string, unknown> | undefined,
  cost: number | undefined,
): Parameters<SupabaseLogger["completePipelineRun"]>[1] {
  return {
    outcome: outcome.outcome,
    outcome_reason: outcome.outcomeReason,
    error_message: outcome.errorMessage?.slice(0, 2000),
    warnings,
    final_stage: outcome.finalStage,
    bot_name: bot.name,
    ab_test_picks: bot.picks,
    bot_config: bot.config,
    note_text: joinNoteAndUrl(result.noteResult.note, result.noteResult.url),
    source_url: result.noteResult.url,
    note_status: result.noteResult.status,
    search_results: result.searchContextResult.searchResults?.slice(0, 10000),
    check_reasoning: result.checkResult,
    logs,
    cost,
  };
}

const STACK_FRAMES_TO_KEEP = 12;
const ERROR_MESSAGE_MAX_LEN = 2000;

async function recordFailedRun(
  logger: SupabaseLogger | null,
  pipelineRunId: string | null,
  post: Post,
  bot: Bot,
  err: any,
): Promise<ProcessTweetResult> {
  console.error(`[processTweet] Bot pipeline failed for ${post.id}:`, err);

  const outcomeReason = err instanceof PipelineError ? err.outcomeReason : "bot_error";
  const message = err?.message ?? String(err);
  const stack = err?.stack
    ? err.stack.split("\n").slice(0, STACK_FRAMES_TO_KEEP).join("\n")
    : undefined;

  const cost = aggregateAndLogCosts()?.cost;

  const log = getTweetLog();
  log?.set("outcome.result", "failed");
  log?.set("outcome.reason", outcomeReason);
  log?.set("outcome.finalStage", "error");
  log?.set("error.message", message);
  if (stack) log?.set("error.stack", stack);

  if (logger && pipelineRunId) {
    const logs = log ? nestDotKeys(Object.fromEntries(log)) : undefined;
    const loggedBot = getLoggedBotIdentity(bot.id, log);
    try {
      await logger.completePipelineRun(pipelineRunId, {
        outcome: "failed",
        outcome_reason: outcomeReason,
        error_message: message.slice(0, ERROR_MESSAGE_MAX_LEN),
        warnings: collectWarnings(),
        final_stage: "error",
        bot_name: loggedBot.name,
        ab_test_picks: loggedBot.picks,
        bot_config: loggedBot.config,
        logs,
        cost,
      });
    } catch (dbErr) {
      console.warn(`[processTweet] Failed to record failure DB row:`, dbErr);
    }
  }

  return {
    pipelineResult: null,
    outcome: "failed",
    outcomeReason,
    finalStage: "error",
    scores: [],
    pipelineRunId,
  };
}

/** Completes the run as rejected at one of the early gates, before the bot ever
 *  ran, and builds the ProcessTweetResult the caller returns. */
async function recordGateRejection(
  logger: SupabaseLogger | null,
  pipelineRunId: string | null,
  bot: Bot,
  outcomeReason: string,
  finalStage: string,
): Promise<ProcessTweetResult> {
  const log = getTweetLog();
  log?.set("outcome.result", "rejected");
  log?.set("outcome.reason", outcomeReason);
  log?.set("outcome.finalStage", finalStage);
  const cost = aggregateAndLogCosts()?.cost;

  if (logger && pipelineRunId) {
    const logs = log ? nestDotKeys(Object.fromEntries(log)) : undefined;
    const loggedBot = getLoggedBotIdentity(bot.id, log);
    try {
      await logger.completePipelineRun(pipelineRunId, {
        outcome: "rejected",
        outcome_reason: outcomeReason,
        final_stage: finalStage,
        bot_name: loggedBot.name,
        ab_test_picks: loggedBot.picks,
        bot_config: loggedBot.config,
        logs,
        cost,
      });
    } catch (err) {
      console.warn(`[processTweet] Failed to record ${outcomeReason} rejection:`, err);
    }
  }

  return {
    pipelineResult: null,
    outcome: "rejected",
    outcomeReason,
    finalStage,
    scores: [],
    pipelineRunId,
  };
}

/**
 * The blocked-topic gate. It runs when `config.topic_filter` is on, which the
 * TOPIC_FILTER_TEST decides. It runs before everything else, even before the
 * note-needed prefilter. It is one cheap deepseek call with no tools. When the
 * post is on a blocked topic the run is completed as rejected with the reason
 * blocked_topic and the bot never runs. It returns null when the filter is off
 * or the post is clean, and the caller then carries on.
 */
async function runTopicFilterGate(
  logger: SupabaseLogger | null,
  pipelineRunId: string | null,
  userMessage: string,
  bot: Bot,
): Promise<ProcessTweetResult | null> {
  if (!getBotConfig().topic_filter) return null;

  // runBlockedTopicFilter writes its own messages and its verdict onto the
  // ambient tweet log under the topic_filter prefix.
  const verdict = await runBlockedTopicFilter(userMessage);
  if (!verdict.blocked) return null;
  return recordGateRejection(logger, pipelineRunId, bot, "blocked_topic", "topic_filter");
}

/**
 * The cheap note-needed prefilter gate. It runs the deepseek prefilter before
 * the bot when `config.note_prefilter` is on and this is not the misinfo
 * pre-pass. When the prefilter says no note is needed, the run is completed as
 * rejected with the reason prefilter_no_note. Returning that result lets the
 * caller skip the bot, which is the expensive part. It returns null when the
 * prefilter is off or says a note may be needed, and the bot then runs.
 */
async function runPrefilterGate(
  logger: SupabaseLogger | null,
  pipelineRunId: string | null,
  userMessage: string,
  bot: Bot,
): Promise<ProcessTweetResult | null> {
  if (!getBotConfig().note_prefilter || getMonitoringContext()) return null;

  // runNoteNeededPrefilter writes its own steps and its verdict onto the tweet
  // log under the note_prefilter_steps prefix. It also folds its cost into the
  // run total.
  const verdict = await runNoteNeededPrefilter(userMessage);
  if (verdict.needsNote) return null;
  return recordGateRejection(logger, pipelineRunId, bot, "prefilter_no_note", "prefilter");
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function processSingleTweet(
  options: ProcessTweetOptions
): Promise<ProcessTweetResult> {
  const { post, bot, logger, commitSha } = options;

  let pipelineRunId: string | null = null;
  if (logger) {
    pipelineRunId = await initPipelineRun(logger, post, commitSha);
  }

  try {
    // The shared bot input is built exactly once, here. Both gates below read
    // the resulting user message directly. The bot asks for the input again
    // later, but the in-memory input cache hands it this same one, so nothing is
    // built twice.
    const input = await createBotInput(post, `processTweet:${post.id}`);
    const userMessage = buildUserMessageFromInput(post, input);

    const topicFiltered = await runTopicFilterGate(logger, pipelineRunId, userMessage, bot);
    if (topicFiltered) return topicFiltered;

    const prefiltered = await runPrefilterGate(logger, pipelineRunId, userMessage, bot);
    if (prefiltered) return prefiltered;

    const { result } = await runBotPipeline(post, bot);
    if (!result) {
      throw new PipelineError("Bot returned null without throwing");
    }

    const scoring = await scorePipelineResult(result);
    await logScoresToDb(logger, pipelineRunId, scoring.scores);

    const outcome = determineOutcome(result, scoring);

    const log = getTweetLog();
    log?.set("outcome.result", outcome.outcome);
    log?.set("outcome.reason", outcome.outcomeReason ?? "");
    log?.set("outcome.finalStage", outcome.finalStage);
    log?.set("note.status", result.noteResult.status);
    const submittedNote = joinNoteAndUrl(result.noteResult.note, result.noteResult.url);
    log?.set("note.text", submittedNote);
    log?.set("note.url", result.noteResult.url);
    log?.set("note.charCount", countNoteLength(submittedNote));
    if (result.checkResult != null) {
      log?.set("sourceCheck.result", result.checkResult.trim().toUpperCase());
    }

    const cost = aggregateAndLogCosts()?.cost;
    const warnings = collectWarnings();

    if (logger && pipelineRunId) {
      const logs = log ? nestDotKeys(Object.fromEntries(log)) : undefined;
      const loggedBot = getLoggedBotIdentity(bot.id, log);
      const completionData = buildSuccessCompletionData(result, loggedBot, outcome, warnings, logs, cost);
      try {
        await logger.completePipelineRun(pipelineRunId, completionData);
      } catch (err) {
        console.warn(`[processTweet] Failed to complete pipeline run:`, err);
      }
    }

    return {
      pipelineResult: result,
      outcome: outcome.outcome,
      outcomeReason: outcome.outcomeReason,
      finalStage: outcome.finalStage,
      noteStatus: result.noteResult.status,
      evaluationScore: scoring.evalGate.score,
      noteText: joinNoteAndUrl(result.noteResult.note, result.noteResult.url),
      scores: scoring.scores,
      pipelineRunId,
    };
  } catch (err: any) {
    return await recordFailedRun(logger, pipelineRunId, post, bot, err);
  }
}
