/**
 * Run pipeline.
 *
 * This is the single-pass pipeline. It fetches tweets, generates notes and
 * submits them straight away.
 *
 * It runs on GitHub Actions every 30 minutes.
 *
 * Flags:
 *   --local              Routes Supabase to LOCAL_SUPABASE_URL and
 *                        LOCAL_SUPABASE_SERVICE_KEY. It also writes a CSV and
 *                        opens the dashboard automatically.
 *   --pick test=variant  Forces a specific A/B test variant. You can pass it
 *                        more than once. The bot itself is chosen by the "bot"
 *                        test, so pass --pick bot=<id> to force a bot.
 */

import { captureProdSupabaseCreds } from "../local/prodSupabaseCreds";
import { fetchClaimCheckHealth, queueIsStuck } from "../service/client";

function takeAllPicks(): Record<string, string> {
  const picks: Record<string, string> = {};
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== "--pick") continue;
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) {
      console.error("--pick requires a value of the form test=variant");
      process.exit(1);
    }
    const eq = value.indexOf("=");
    if (eq < 1 || eq === value.length - 1) {
      console.error(`--pick value must be test=variant (got "${value}")`);
      process.exit(1);
    }
    picks[value.slice(0, eq)] = value.slice(eq + 1);
  }
  return picks;
}

const isLocal = process.argv.includes("--local");
const forcedPicks = takeAllPicks();
if (isLocal) {
  captureProdSupabaseCreds();
  const localUrl = process.env.LOCAL_SUPABASE_URL;
  const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
  if (localUrl && localKey) {
    process.env.SUPABASE_URL = localUrl;
    process.env.SUPABASE_SERVICE_KEY = localKey;
    console.log(`[pipeline] Using local Supabase at ${localUrl}`);
  } else {
    console.error("[pipeline] --local requires LOCAL_SUPABASE_URL and LOCAL_SUPABASE_SERVICE_KEY in env");
    process.exit(1);
  }

  // Route X API calls to the local test account. This must happen before any X
  // API module is imported, because those modules read the variables as they
  // load.
  for (const [src, dest] of Object.entries({
    LOCAL_X_API_KEY: "X_API_KEY",
    LOCAL_X_API_KEY_SECRET: "X_API_KEY_SECRET",
    LOCAL_X_ACCESS_TOKEN: "X_ACCESS_TOKEN",
    LOCAL_X_ACCESS_TOKEN_SECRET: "X_ACCESS_TOKEN_SECRET",
  })) {
    if (process.env[src]) process.env[dest] = process.env[src];
  }
}

import { SupabaseLogger } from "../api/supabaseClient";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { generateCandidates, type TweetProcessedEvent } from "../pipeline/orchestration/generateCandidates";
import { generateMisinfoCandidates } from "../pipeline/misinfo-monitoring/generateMisinfoCandidates";
import type { MisinfoTopicId } from "../pipeline/misinfo-monitoring/topicIds";
import { submitCandidates, misinfoReserveRemaining, type Candidate, type SubmitOptions } from "../pipeline/orchestration/submitCandidates";
import { computeMaxPosts, fetchRecentChecks, X_DAILY_SPEND_CAP_USD } from "../pipeline/orchestration/computeMaxPosts";
import { startOfUtcDay } from "../pipeline/utils/utcDay";
import { buildRunName, initOutputFolder, resultToCsvRow, type OutputFolder } from "../local/outputWriter";
import { autoOpenInDashboard } from "../local/dashboardAutoOpen";
import { getForcedPicks, withForcedPicks } from "../pipeline/ab-testing/abTests";
import { CLAUDE_TWEET_MAX_WAIT_MINUTES, PIPELINE_BOT, waitForClaudeTweets } from "../pipeline/orchestration/claudeTweets";
import { claudeUnavailableReason } from "../claude-notes/xShare";
import { activeScorer, pickRankingPolicy } from "../pipeline/ranking/policy";
import { barEnabled, barFor, estimateWindow, type Window } from "../pipeline/capacity/window";
import { automaticGenerationPreflight, type SubmissionCapacity } from "../pipeline/capacity/submissionReserve";
import { loadNoteQueue, mergeWithQueue, noteQueueEnabled, shouldExploreFirst, submittableQueued } from "../pipeline/orchestration/noteQueue";
import { raterBar } from "../pipeline/score/raterBar";
import { syncAbTests } from "../pipeline/ab-testing/syncAbTests";

function postUrl(postId: string): string {
  return `https://x.com/i/status/${postId}`;
}

function writePipelineRowToCsv(output: OutputFolder, event: TweetProcessedEvent): void {
  const row = resultToCsvRow(
    { url: postUrl(event.post.id) },
    event.botId,
    event.tweetResult,
    "",
    event.log,
  );
  output.appendRow(row);
}

// The cron fires every 30 minutes, so 27 minutes is how much wall clock a run
// gets without overlapping the next tick. The GitHub Actions job timeout of 35
// minutes sits above this, and setup takes several minutes on top of it. So the
// normal way a long run stops is our own watchdog exiting cleanly, not the
// runner killing the job.
const MAX_RUNTIME_MS = 27 * 60 * 1000;
const MAX_POSTS_LOCAL = 5;
const MAX_POSTS_FALLBACK = 5;

// Activates the misinfo-monitoring pre-pass, and only for the topics listed
// below. A live run writes real notes and submits them to X. Set this to false
// to switch the pre-pass off.
// Switched off 2026-09-01 (GOO-94): of the 174 topic notes submitted since
// June, zero were rated helpful, against 11.3% for regular notes in the same
// window. To turn topics back on, set this to true and list the active topic
// ids again. The empty topic list below also keeps the regular feed's topic
// curation off.
const MISINFO_PIPELINE_ENABLED = false;
const MISINFO_ACTIVE_TOPIC_IDS: MisinfoTopicId[] = [];

const globalTimeout = setTimeout(async () => {
  console.log("[pipeline] Maximum runtime reached (27 minutes), forcing exit");
  await closeBrowser();
  process.exit(0);
}, MAX_RUNTIME_MS);

// The soft deadline is when the run stops STARTING work so it can finish and
// submit what it has. The five minutes between it and the hard kill above are
// the submit phase's guaranteed budget plus room for the posts still in
// flight. Before this existed, a run that outran the hard kill stranded every
// note it had finished — 37 stranded against 46 submitted on 2026-08-26.
const RUN_STARTED_AT_MS = Date.now();
const SOFT_DEADLINE_AT_MS = RUN_STARTED_AT_MS + 22 * 60 * 1000;

// How much wall clock one post costs to process, for sizing a batch to the
// clock. This number is tied to CONCURRENCY_LIMIT in generateCandidates: at
// concurrency 5 a healthy run did a post roughly every two minutes of wall
// time, so at concurrency 10 the figure halves. The estimate also sizes
// OPTIMISTICALLY, slightly under that, and this is safe on purpose: since the
// deadline stopped waiting for stragglers, an oversized batch costs only its
// unfinished tail — every finished note still submits — while an undersized
// batch costs real notes against a cap we are not filling. When over- and
// under-shooting have asymmetric prices, size toward the cheap mistake.
const EST_WALL_MS_PER_POST = 1 * 60 * 1000;

// The misinfo pre-pass processes its finds through the full pipeline before
// the regular pass gets the clock, so a heavy misinfo run used to starve the
// regular batch. Its processing now stops at this sub-deadline; the crawl and
// the selection judge run before it and are quick. Regular posts get whatever
// the pre-pass leaves, which this floor keeps at ~15 of the 22 minutes.
const MISINFO_PROCESSING_BUDGET_MS = 7 * 60 * 1000;

/** The tweets are checked by the claim-check service, so a run without a
 *  healthy service can only burn its dispatch slot. Failing here makes a dead
 *  or wedged machine show up as a red run, which is the only monitoring the
 *  machine has. */
async function assertCheckServiceHealthy(): Promise<void> {
  const health = await fetchClaimCheckHealth();
  console.log(
    `[pipeline] claim-check service: ${health.inFlight} in flight, ${health.waiting} waiting`,
  );
  if (queueIsStuck(health)) {
    throw new Error("The claim-check service is stuck. Failing the run so this is seen.");
  }
}

async function main() {
  try {
    await assertCheckServiceHealthy();
    let supabaseLogger: SupabaseLogger | null = null;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        supabaseLogger = new SupabaseLogger();
        console.log("[pipeline] Supabase logging enabled");
      } catch (err) {
        console.warn("[pipeline] Failed to initialize Supabase logger:", err);
      }
    } else {
      console.log("[pipeline] Supabase logging disabled (env vars not set)");
    }

    if (!isLocal) await syncAbTests();

    // Submission still takes an atomic claim after this generation snapshot.
    let capacity: SubmissionCapacity | undefined;
    if (!isLocal) {
      const preflight = await automaticGenerationPreflight(supabaseLogger);
      if (!preflight.allowed) {
        console.log(`[pipeline] Skipping automatic generation — ${preflight.reason}`);
        clearTimeout(globalTimeout);
        await closeBrowser();
        return;
      }
      capacity = preflight.capacity;
    }

    // Clear the in_progress rows left behind by an earlier run that was killed
    // before it could finalize them. The workflow's concurrency group stops two
    // runs from overlapping, so this can never sweep a live run's rows.
    if (supabaseLogger) {
      try {
        const swept = await supabaseLogger.sweepStuckRuns({ olderThanMinutes: 30, claudeOlderThanMinutes: CLAUDE_TWEET_MAX_WAIT_MINUTES });
        if (swept > 0) console.log(`[pipeline] Swept ${swept} stuck in_progress run(s)`);
      } catch (err) {
        console.warn("[pipeline] Sweeper failed (continuing anyway):", err);
      }
    }

    // Notes from earlier runs that X had no room for. They compete with this
    // run's fresh notes for the slots, in note-rater order.
    const queueOn = noteQueueEnabled() && !isLocal && supabaseLogger !== null;
    let queued: Candidate[] = [];
    let raterBarValue: number | null = null;
    let exploreFirst = false;
    if (queueOn) {
      try {
        queued = await loadNoteQueue(supabaseLogger!);
      } catch (err) {
        console.warn("[noteQueue] could not load the queue; this run submits only its own notes:", err);
      }
      raterBarValue = raterBar();
      console.log(`[raterBar] a note goes out when its calibrated helpful minus not-helpful chance is at least ${raterBarValue === null ? "(no bar)" : raterBarValue}`);
      exploreFirst = await shouldExploreFirst(supabaseLogger!);
    }

    // The queued notes that would actually go out fill X's room before any new tweet is checked.
    const queuedReady = submittableQueued(queued, raterBarValue).length;
    let maxPosts = isLocal
      ? MAX_POSTS_LOCAL
      : capacity && supabaseLogger
        ? computeMaxPosts(capacity, await fetchRecentChecks(supabaseLogger), queuedReady)
        : MAX_POSTS_FALLBACK;
    if (capacity) {
      console.log(`[max-posts] X has room for ${capacity.probe ? "1 (cooldown probe)" : capacity.remaining ?? "an unknown number of"} note(s), ${queuedReady} queued note(s) fill it first; checking ${maxPosts} tweet(s)`);
    }

    if (!isLocal && supabaseLogger) {
      const spentTodayUsd = await supabaseLogger.fetchCostSinceUsd(startOfUtcDay());
      console.log(`[spend-cap] the X bot spent $${spentTodayUsd.toFixed(2)} of its $${X_DAILY_SPEND_CAP_USD} today (UTC)`);
      if (spentTodayUsd >= X_DAILY_SPEND_CAP_USD) {
        console.log("[spend-cap] daily spend cap reached: no new tweets until midnight UTC, queued notes still go out");
        maxPosts = 0;
      }
    }

    if (maxPosts === 0 && queued.length === 0) {
      console.log("[pipeline] Skipping: no new tweets to check and no queued notes to submit");
      clearTimeout(globalTimeout);
      await closeBrowser();
      process.exit(0);
    }

    // With --local we collect the per-tweet results into a CSV and open the
    // dashboard on them afterwards.
    const localOutput: OutputFolder | null = isLocal
      ? initOutputFolder("pipeline", "run", undefined)
      : null;
    // Every tweet's outcome is recorded, so the run can fail at the end when
    // every check failed.
    const tweetOutcomes: TweetProcessedEvent["tweetResult"]["outcome"][] = [];
    const onTweetProcessed = (event: TweetProcessedEvent) => {
      tweetOutcomes.push(event.tweetResult.outcome);
      if (localOutput) writePipelineRowToCsv(localOutput, event);
    };

    // Track every tweet a pre-pass processes, so the regular pass skips it.
    // The pre-passes write their tweets to the tweets table, but a failed write
    // is only logged, so the database alone cannot be trusted with this.
    const processedThisRun = new Set<string>();
    const trackPrePassProcessed = (event: TweetProcessedEvent) => {
      processedThisRun.add(event.post.id);
      return onTweetProcessed?.(event);
    };

    // The misinfo-monitoring pre-pass runs first, scoped to
    // MISINFO_ACTIVE_TOPIC_IDS. If it fails, the regular pipeline still runs.
    // A failure here must never take down regular note-writing. Its candidates
    // also share the single submit call and the daily cap.
    let misinfoCandidates: Candidate[] = [];
    if (MISINFO_PIPELINE_ENABLED) {
      try {
        misinfoCandidates = await generateMisinfoCandidates(supabaseLogger, {
          deadlineMs: Math.min(SOFT_DEADLINE_AT_MS, RUN_STARTED_AT_MS + MISINFO_PROCESSING_BUDGET_MS),
          onTweetProcessed: trackPrePassProcessed,
          topicIds: MISINFO_ACTIVE_TOPIC_IDS,
        });
      } catch (err) {
        console.warn("[pipeline] Misinfo pre-pass failed; continuing with regular pipeline only:", err);
      }
    } else {
      console.log("[pipeline] Misinfo pre-pass disabled (MISINFO_PIPELINE_ENABLED=false)");
    }

    // Size the regular batch to the clock that is actually left. The misinfo
    // pre-pass above eats a variable slice of the run, and selecting more
    // posts than the remaining minutes can process only queues work for the
    // deadline to cut.
    const remainingMs = SOFT_DEADLINE_AT_MS - Date.now();
    const clockBudgetPosts = Math.max(1, Math.floor(remainingMs / EST_WALL_MS_PER_POST));
    if (clockBudgetPosts < maxPosts) {
      console.log(
        `[max-posts] clock: ${(remainingMs / 60_000).toFixed(1)} min to the soft deadline — ` +
          `capping maxPosts ${maxPosts} -> ${clockBudgetPosts}`,
      );
      maxPosts = clockBudgetPosts;
    }

    const scorer = activeScorer(rankingPolicy);
    let window: Window | null = null;
    let bar: number | null = null;
    let barState: SubmitOptions["barState"] = scorer ? "off" : "none";
    const useBar = scorer !== null && barEnabled() && !queueOn;
    if (supabaseLogger && !isLocal) {
      try {
        window = await estimateWindow(supabaseLogger);
        if (scorer && useBar && window.cap !== null) {
          bar = await barFor(supabaseLogger, scorer.name, window.cap);
          barState = bar === null ? "off" : bar === -Infinity ? "admit_all" : bar === Infinity ? "reject_all" : "set";
        }
        if (queueOn) {
          bar = raterBarValue;
          barState = bar === null ? "off" : "set";
        }
      } catch (err) {
        if (useBar) barState = "error";
        console.warn("[ranking] window/bar estimate failed; submitting without a bar:", err);
      }
    }
    console.log(
      `[ranking] policy=${rankingPolicy}` +
        (window ? ` cap=${window.cap ?? "?"} (${window.capSource}) used24h=${window.used24h} headroom=${window.remaining ?? "?"} (estimate; X's 403 is the stop)` : "") +
        (queueOn ? ` raterBar=${bar === null ? "off" : bar.toFixed(3)}` : scorer ? ` bar=${bar === null ? "off" : bar === -Infinity ? "admit-all" : bar === Infinity ? "reject-all" : bar.toFixed(2)}` : ""),
    );

    // A third of the tweets go to the Claude Code note writer on the ai-box.
    // While the X share of Nathan's Claude plan has no room, those tweets fail.
    // A local run writes to the local database, which the ai-box never reads,
    // so it keeps every tweet with the pipeline.
    const claudeUnavailable = isLocal || !supabaseLogger ? null : await claudeUnavailableReason();
    const generatePicks = isLocal && !forcedPicks.bot ? { ...getForcedPicks(), bot: PIPELINE_BOT } : getForcedPicks();
    const regularCandidates = maxPosts === 0 ? [] : await withForcedPicks(generatePicks, () => generateCandidates(supabaseLogger, {
      maxPosts,
      deadlineMs: SOFT_DEADLINE_AT_MS,
      scorer,
      processedThisRun,
      onTweetProcessed,
      // Curated-topic matching also runs on the regular pool. A post confirmed
      // to be on topic gets the monitoring treatment and a bounded share of
      // maxPosts. The code for that lives in regularFeedTopicCuration.ts. Pass
      // an empty array to disable it.
      topicIds: MISINFO_ACTIVE_TOPIC_IDS,
      claudeUnavailable,
    }));

    // This array fixes the submission order, because submitCandidates does not
    // re-sort it. Misinfo notes get priority, but only up to a bound. The first
    // few are however many the 24-hour reserve has left, and they arrive already
    // ranked by velocity. Those go ahead of the regular notes. The rest fall in
    // behind them, so a day heavy with topic posts cannot eat the whole daily
    // cap.
    // The notes of this run's Claude tweets go into the queue, so the run waits
    // for them and loads the queue again before it submits.
    if (queueOn && maxPosts > 0) {
      await waitForClaudeTweets(supabaseLogger!, new Date(RUN_STARTED_AT_MS), SOFT_DEADLINE_AT_MS);
      queued = await loadNoteQueue(supabaseLogger!);
    }
    const misinfoReserve = supabaseLogger ? await misinfoReserveRemaining(supabaseLogger) : 0;
    const candidates = mergeWithQueue([
      ...misinfoCandidates.slice(0, misinfoReserve),
      ...regularCandidates,
      ...misinfoCandidates.slice(misinfoReserve),
    ], queued);
    if (candidates.length > 0 && supabaseLogger) {
      const submitted = await submitCandidates(candidates, supabaseLogger, isLocal, { policy: rankingPolicy, scorer, window, bar, barState, queue: queueOn, exploreFirst });
      console.log(`[pipeline] Submitted ${submitted} of ${candidates.length} candidates (${misinfoCandidates.length} misinfo, ${regularCandidates.length} regular, ${candidates.length - regularCandidates.length - misinfoCandidates.length} queued)`);
    } else {
      console.log(`[pipeline] No candidates to submit`);
    }

    if (localOutput) {
      await autoOpenInDashboard(localOutput.csvPath, buildRunName("pipeline", "local"));
    }

    // A failed tweet is recorded on its pipeline_runs row, and the run used to
    // end green. About half of all runs have a tweet or two whose sources could
    // not be fetched, so one failure is normal. But when every tweet fails,
    // something shared is broken, such as a model provider or the claim-check
    // service. In the week before this check was added, no run had every tweet
    // fail. So that case fails the run, after the submission above has sent
    // what it could.
    if (tweetOutcomes.length > 0 && tweetOutcomes.every((outcome) => outcome === "failed")) {
      throw new Error(
        `Every one of the ${tweetOutcomes.length} tweets this run checked failed. ` +
          "The reasons are in the log above and in pipeline_runs.error_message. Failing the run so this is seen.",
      );
    }

    console.log("[pipeline] Pipeline completed successfully");
    clearTimeout(globalTimeout);
    await closeBrowser();
    process.exit(0);
  } catch (error: any) {
    console.error("[pipeline] Fatal error:", error.response?.data || error);
    clearTimeout(globalTimeout);
    await closeBrowser();
    process.exit(1);
  }
}

const rankingPolicy = pickRankingPolicy(forcedPicks.ranking_policy);
withForcedPicks({ ...forcedPicks, ranking_policy: rankingPolicy }, main);
