/**
 * Process Single Tweet
 *
 * Core per-tweet pipeline logic extracted from generateCandidates.ts.
 * Split into three layers:
 *   1. runBotPipeline()    — runs the bot, returns raw output
 *   2. scorePipelineResult() — computes all scores
 *   3. determineOutcome()  — pure function, decides outcome from result + scores
 *
 * processSingleTweet() is the thin orchestrator that glues them together.
 */

import type { Post } from "../../api/fetchEligiblePosts";
import type { SupabaseLogger } from "../../api/supabaseClient";
import type { Bot, PipelineResult, PostContent } from "../../bots/types";
import { getOriginalTweetContent } from "../../utils/retweetUtils";
import { runNoteScores, countSources, applyScoreFilters, type AllNoteScores } from "../score/noteScores";
import { shouldSubmitNote } from "../score/noteEvaluationFilter";
import { getTweetLog, getLoggedBotIdentity, nestDotKeys } from "../utils/tweetLog";
import { withCostTracker, aggregateAndLogCosts } from "../utils/costTracker";

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
  warnings?: string[];
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
  sourceCountScore?: number;
  noteText?: string;
  scores: ScoreEntry[];
  pipelineRunId: string | null;
  warnings?: string[];
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

  const warnings = result?.warnings?.length
    ? result.warnings.map((w) => `[WARNING] ${w}`)
    : undefined;
  if (warnings) {
    log?.set("warnings", warnings);
  }

  return { result, content, warnings };
}

// ---------------------------------------------------------------------------
// Layer 2: Score pipeline result (computes scores, no outcome decisions)
// ---------------------------------------------------------------------------

interface ScoringOutput {
  scores: ScoreEntry[];
  /** Typed note scores (when runNoteScores succeeded). Used for filter gating. */
  noteScores?: AllNoteScores;
  evaluationScore?: number;
  sourceCountScore?: number;
  /** Whether eval says we should submit (undefined if eval failed/skipped) */
  evalShouldSubmit?: boolean;
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

async function computeEvaluationScore(
  postId: string,
  noteText: string
): Promise<{ score?: number; shouldSubmit?: boolean; error?: string }> {
  try {
    const result = await shouldSubmitNote(postId, noteText, 0);
    return {
      score: result.score,
      shouldSubmit: result.error ? undefined : result.shouldSubmit,
      error: result.error,
    };
  } catch (err: any) {
    console.warn(`[processTweet] Eval API failed for ${postId}:`, err?.message);
    return { error: err?.message };
  }
}

const NOTE_SCORE_FIELDS: Array<{ name: string; key: keyof AllNoteScores }> = [
  { name: "positive_evidence", key: "positiveEvidence" },
  { name: "disagreement", key: "disagreement" },
  { name: "helpfulness", key: "helpfulness" },
  { name: "source_quality", key: "sourceQuality" },
  { name: "breaking_news_risk", key: "breakingNewsRisk" },
  { name: "pedantry", key: "pedantry" },
  { name: "note_not_needed", key: "noteNotNeeded" },
  { name: "tangential_correction", key: "tangentialCorrection" },
  { name: "rater_verifiability", key: "raterVerifiability" },
  { name: "overconfidence", key: "overconfidence" },
];

function noteScoresToEntries(scores: AllNoteScores): ScoreEntry[] {
  return NOTE_SCORE_FIELDS.map(({ name, key }) => ({
    type: name,
    value: scores[key].score,
    metadata: { reasoning: scores[key].reasoning },
  }));
}

async function computeNoteQualityScores(
  tweetText: string,
  noteText: string,
  searchResults: string,
  sourceUrl: string
): Promise<{ scores: AllNoteScores; entries: ScoreEntry[] }> {
  const scores = await runNoteScores(noteText, tweetText, searchResults, sourceUrl);
  return { scores, entries: noteScoresToEntries(scores) };
}

async function scorePipelineResult(
  result: PipelineResult,
  post: Post
): Promise<ScoringOutput> {
  const scores: ScoreEntry[] = [];
  const noteText = result.noteResult.note + " " + result.noteResult.url;

  // Source verification
  const svScore = extractSourceVerificationScore(result);
  if (svScore) scores.push(svScore);

  // Bot scoring filter results
  scores.push(...extractBotScoringFilterScores(result));

  // Evaluation score
  let evaluationScore: number | undefined;
  let evalShouldSubmit: boolean | undefined;
  const evalResult = await computeEvaluationScore(result.post.id, noteText);
  if (evalResult.score !== undefined) {
    evaluationScore = evalResult.score;
    evalShouldSubmit = evalResult.shouldSubmit;
    scores.push({
      type: "evaluation",
      value: evalResult.score,
      metadata: evalResult.error ? { error: evalResult.error } : undefined,
    });
  }

  // Source count
  let sourceCountScore: number | undefined;
  try {
    sourceCountScore = countSources(noteText);
    scores.push({ type: "pred_source_count", value: sourceCountScore });
  } catch (err: any) {
    console.warn(`[processTweet] Source count failed:`, err?.message);
  }

  // Note quality scores
  let noteScores: AllNoteScores | undefined;
  try {
    const quality = await computeNoteQualityScores(
      post.text,
      noteText,
      result.searchContextResult.searchResults ?? "",
      result.noteResult.url ?? ""
    );
    noteScores = quality.scores;
    scores.push(...quality.entries);
  } catch (err: any) {
    console.warn(`[processTweet] Note scores failed for ${post.id}:`, err?.message);
  }

  return { scores, noteScores, evaluationScore, sourceCountScore, evalShouldSubmit };
}

// ---------------------------------------------------------------------------
// Layer 3: Determine outcome (pure function, no side effects)
// ---------------------------------------------------------------------------

const STATUS_REJECTION_MAP: Record<string, { reason: string; stage: string }> = {
  SCORING_FILTERS_FAILED: { reason: "scoring_filters_failed", stage: "scoring" },
  SOURCE_TRUST_FAILED: { reason: "source_trust_failed", stage: "source_trust" },
};

const CORRECTION_STATUS = "CORRECTION WITH TRUSTWORTHY CITATION";

function determineOutcome(
  result: PipelineResult | null,
  scores: ScoreEntry[],
  noteScores: AllNoteScores | undefined,
  evalShouldSubmit?: boolean
): Outcome {
  // Bot returned nothing
  if (!result) {
    return { outcome: "failed", outcomeReason: "bot_returned_null", finalStage: "started" };
  }

  // Bot returned an error
  if (result.error) {
    return { outcome: "failed", outcomeReason: "bot_error", finalStage: result.lastStage };
  }

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

  // Score filter rejection (filters come from the bot's config)
  if (result.scoreFilters?.length && noteScores) {
    const failure = applyScoreFilters(noteScores, result.scoreFilters);
    if (failure) {
      return {
        outcome: "rejected",
        outcomeReason: "scoring_filters_failed",
        finalStage: "scoring",
        errorMessage: failure.reason,
      };
    }
  }

  // Evaluation score rejection
  if (evalShouldSubmit === false) {
    const evalScore = scores.find((s) => s.type === "evaluation");
    return {
      outcome: "rejected",
      outcomeReason: "low_evaluation_score",
      finalStage: "evaluation",
      errorMessage: evalScore?.value !== undefined ? `score ${evalScore.value} below threshold` : undefined,
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

function buildCompletionData(
  result: PipelineResult | null,
  bot: { name: string; nameLong: string; config?: Record<string, unknown> },
  outcome: Outcome,
  warnings: string[] | undefined,
  logs: Record<string, unknown> | undefined,
  cost: number | undefined,
): Parameters<SupabaseLogger["completePipelineRun"]>[1] {
  const warningText = warnings?.join("; ");
  const errorParts = [warningText, outcome.errorMessage].filter(Boolean);

  return {
    outcome: outcome.outcome,
    outcome_reason: outcome.outcomeReason,
    error_message: errorParts.length ? errorParts.join(" | ").slice(0, 2000) : undefined,
    final_stage: outcome.finalStage,
    bot_name: bot.name,
    bot_name_long: bot.nameLong,
    bot_config: bot.config,
    note_text: result ? result.noteResult.note + " " + result.noteResult.url : undefined,
    source_url: result?.noteResult?.url,
    note_status: result?.noteResult?.status,
    search_results: result?.searchContextResult?.searchResults?.slice(0, 10000),
    check_reasoning: result?.checkResult,
    logs,
    cost,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function processSingleTweet(
  options: ProcessTweetOptions
): Promise<ProcessTweetResult> {
  return withCostTracker(() => processSingleTweetInner(options));
}

async function processSingleTweetInner(
  options: ProcessTweetOptions
): Promise<ProcessTweetResult> {
  const { post, bot, logger, commitSha } = options;

  // 1. Run bot pipeline
  let pipelineOutput: BotPipelineOutput;
  try {
    pipelineOutput = await runBotPipeline(post, bot);
  } catch (err: any) {
    console.error(`[processTweet] Bot pipeline failed for ${post.id}:`, err);
    const errorResult: PipelineResult = {
      post,
      botId: bot.id,
      lastStage: "error",
      searchContextResult: { text: post.text ?? "", searchResults: "" },
      noteResult: { note: "", url: "", status: "ERROR" },
      error: err.message,
    };
    pipelineOutput = { result: errorResult, content: getOriginalTweetContent(post), warnings: [`[ERROR] ${err.message}`] };
  }
  const { result, warnings } = pipelineOutput;

  // 2. Create DB run
  let pipelineRunId: string | null = null;
  if (logger) {
    pipelineRunId = await initPipelineRun(logger, post, commitSha);
  }

  // 3. Score (only if bot produced a usable result)
  let scores: ScoreEntry[] = [];
  let noteScores: AllNoteScores | undefined;
  let evaluationScore: number | undefined;
  let sourceCountScore: number | undefined;
  let evalShouldSubmit: boolean | undefined;

  if (result && !result.error) {
    const scoring = await scorePipelineResult(result, post);
    scores = scoring.scores;
    noteScores = scoring.noteScores;
    evaluationScore = scoring.evaluationScore;
    sourceCountScore = scoring.sourceCountScore;
    evalShouldSubmit = scoring.evalShouldSubmit;
    await logScoresToDb(logger, pipelineRunId, scores);
  }

  // 4. Determine outcome
  const outcome = determineOutcome(result, scores, noteScores, evalShouldSubmit);

  // 5. Write to tweet log
  const log = getTweetLog();
  log?.set("outcome.result", outcome.outcome);
  log?.set("outcome.reason", outcome.outcomeReason ?? "");
  log?.set("outcome.finalStage", outcome.finalStage);
  if (result) {
    log?.set("note.status", result.noteResult.status);
    log?.set("note.text", result.noteResult.note + " " + result.noteResult.url);
    log?.set("note.url", result.noteResult.url);
    log?.set("note.charCount", (result.noteResult.note + " " + result.noteResult.url).length);
    if (result.checkResult != null) {
      log?.set("sourceCheck.result", result.checkResult.trim().toUpperCase());
    }
  }

  // 6. Complete DB run (with logs).
  // aggregateAndLogCosts writes the cost breakdown to the log AND returns the
  // total — read it directly here instead of re-parsing the log.
  const totalCost = aggregateAndLogCosts();
  if (logger && pipelineRunId) {
    const logs = log ? nestDotKeys(Object.fromEntries(log)) : undefined;
    const loggedBot = getLoggedBotIdentity(bot.id, log);
    const completionData = buildCompletionData(result, loggedBot, outcome, warnings, logs, totalCost?.cost);
    try {
      await logger.completePipelineRun(pipelineRunId, completionData);
    } catch (err) {
      console.warn(`[processTweet] Failed to complete pipeline run:`, err);
    }
  }

  // 7. Return
  const noteText = result ? result.noteResult.note + " " + result.noteResult.url : undefined;
  return {
    pipelineResult: result,
    outcome: outcome.outcome,
    outcomeReason: outcome.outcomeReason,
    finalStage: outcome.finalStage,
    noteStatus: result?.noteResult?.status,
    evaluationScore,
    sourceCountScore,
    noteText,
    scores,
    pipelineRunId,
    warnings,
  };
}
