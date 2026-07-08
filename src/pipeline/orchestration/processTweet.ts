/**
 * Process Single Tweet
 *
 * Core per-tweet pipeline logic extracted from generateCandidates.ts.
 * Split into three layers:
 *   1. runBotPipeline()    — runs the bot, returns raw output
 *   2. scorePipelineResult() — records observational scores (incl. the X eval score)
 *   3. determineOutcome()  — pure function, decides outcome from the result
 *
 * processSingleTweet() is the thin orchestrator that glues them together.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import type { Bot, PipelineResult, PostContent } from "../../bots/types";
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
// Layer 1: Run bot pipeline (no DB, no scoring)
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

/** Warnings collected this run (e.g. media Haiku fallback). Mirrors them into
 *  the tweet log so they also appear in the logs dump, and returns the array
 *  (undefined when none) for the pipeline_runs.warnings column. */
function collectWarnings(): string[] | undefined {
  const warnings = getWarnings();
  if (!warnings.length) return undefined;
  getTweetLog()?.set("warnings", warnings);
  return warnings;
}

// ---------------------------------------------------------------------------
// Layer 2: Score pipeline result (computes scores, no outcome decisions)
// ---------------------------------------------------------------------------

interface ScoringOutput {
  scores: ScoreEntry[];
  evaluationScore?: number;
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

  // Source verification
  const svScore = extractSourceVerificationScore(result);
  if (svScore) scores.push(svScore);

  // Bot scoring filter results
  scores.push(...extractBotScoringFilterScores(result));

  // Evaluation score (observational — recorded for ranking, no longer gates)
  let evaluationScore: number | undefined;
  const evalResult = await getEvaluationScore(result.post.id, noteText);
  if (evalResult.score !== undefined) {
    evaluationScore = evalResult.score;
    scores.push({ type: "evaluation", value: evalResult.score });
  }

  return { scores, evaluationScore };
}

// ---------------------------------------------------------------------------
// Layer 3: Determine outcome (pure function, no side effects)
// ---------------------------------------------------------------------------

const STATUS_REJECTION_MAP: Record<string, { reason: string; stage: string }> = {
  SCORING_FILTERS_FAILED: { reason: "scoring_filters_failed", stage: "scoring" },
  SOURCE_TRUST_FAILED: { reason: "source_trust_failed", stage: "source_trust" },
};

const CORRECTION_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION";

function determineOutcome(result: PipelineResult): Outcome {
  // Status-based rejections
  const statusRejection = STATUS_REJECTION_MAP[result.noteResult.status];
  if (statusRejection) {
    return { outcome: "rejected", outcomeReason: statusRejection.reason, finalStage: statusRejection.stage };
  }

  // No correction needed
  if (result.noteResult.status !== CORRECTION_STATUS) {
    return { outcome: "rejected", outcomeReason: "no_correction_needed", finalStage: "note_writing" };
  }

  // Source verification
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

  // All checks passed
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
  // Note: the tweets row is upserted in bulk at fetch time
  // (see generateCandidates.fetchPosts), so we don't need to do it here.
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

/**
 * Cheap note-needed prefilter gate. When `config.note_prefilter` is on (and this
 * isn't the misinfo pre-pass), run the deepseek prefilter before the bot. If it
 * says no note is needed, complete the run as rejected/prefilter_no_note and
 * return that result so the caller skips the (expensive) bot. Returns null when
 * the prefilter is off or says a note may be needed (proceed to the bot).
 */
async function runPrefilterGate(
  logger: SupabaseLogger | null,
  pipelineRunId: string | null,
  post: Post,
  bot: Bot,
): Promise<ProcessTweetResult | null> {
  if (!getBotConfig().note_prefilter || getMonitoringContext()) return null;

  // runNoteNeededPrefilter logs its own steps under note_prefilter_steps.* (incl.
  // the verdict) and folds its cost into the run total.
  const verdict = await runNoteNeededPrefilter(post);
  const log = getTweetLog();
  if (verdict.needsNote) return null; // proceed to the bot; bot reuses cached input

  log?.set("outcome.result", "rejected");
  log?.set("outcome.reason", "prefilter_no_note");
  log?.set("outcome.finalStage", "prefilter");
  const cost = aggregateAndLogCosts()?.cost;

  if (logger && pipelineRunId) {
    const logs = log ? nestDotKeys(Object.fromEntries(log)) : undefined;
    const loggedBot = getLoggedBotIdentity(bot.id, log);
    try {
      await logger.completePipelineRun(pipelineRunId, {
        outcome: "rejected",
        outcome_reason: "prefilter_no_note",
        final_stage: "prefilter",
        bot_name: loggedBot.name,
        ab_test_picks: loggedBot.picks,
        bot_config: loggedBot.config,
        logs,
        cost,
      });
    } catch (err) {
      console.warn(`[processTweet] Failed to record prefilter rejection:`, err);
    }
  }

  return {
    pipelineResult: null,
    outcome: "rejected",
    outcomeReason: "prefilter_no_note",
    finalStage: "prefilter",
    scores: [],
    pipelineRunId,
  };
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
    const prefiltered = await runPrefilterGate(logger, pipelineRunId, post, bot);
    if (prefiltered) return prefiltered;

    const { result } = await runBotPipeline(post, bot);
    if (!result) {
      throw new PipelineError("Bot returned null without throwing");
    }

    const scoring = await scorePipelineResult(result);
    await logScoresToDb(logger, pipelineRunId, scoring.scores);

    const outcome = determineOutcome(result);

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
      evaluationScore: scoring.evaluationScore,
      noteText: joinNoteAndUrl(result.noteResult.note, result.noteResult.url),
      scores: scoring.scores,
      pipelineRunId,
    };
  } catch (err: any) {
    return await recordFailedRun(logger, pipelineRunId, post, bot, err);
  }
}
