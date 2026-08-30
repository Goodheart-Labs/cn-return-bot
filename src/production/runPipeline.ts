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
import { generatePangramCandidates } from "../pipeline/pangram-monitoring/generatePangramCandidates";
import { generateMisinfoCandidates } from "../pipeline/misinfo-monitoring/generateMisinfoCandidates";
import type { MisinfoTopicId } from "../pipeline/misinfo-monitoring/topicIds";
import { submitCandidates, misinfoReserveRemaining, type Candidate } from "../pipeline/orchestration/submitCandidates";
import { computeMaxPosts } from "../pipeline/orchestration/computeMaxPosts";
import { probeWritingLimitAfterCooldown } from "../pipeline/orchestration/writingLimit";
import { buildRunName, initOutputFolder, resultToCsvRow, type OutputFolder } from "../local/outputWriter";
import { autoOpenInDashboard } from "../local/dashboardAutoOpen";
import { withForcedPicks } from "../pipeline/ab-testing/abTests";
// import { updateWritingLimit } from "../pipeline/orchestration/updateWritingLimit";

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

// Flip to true to re-enable the XXL-feed Pangram AI-detection pre-pass.
const PANGRAM_PIPELINE_ENABLED = false;

// Activates the misinfo-monitoring pre-pass, and only for the topics listed
// below. The evergreen topics are not included. A live run writes real notes and
// submits them to X. Set this to false to switch the pre-pass off.
const MISINFO_PIPELINE_ENABLED = true;
const MISINFO_ACTIVE_TOPIC_IDS: MisinfoTopicId[] = ["trump_election_security"];

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
// clock. Healthy runs at concurrency 5 do a post roughly every two minutes of
// wall time. The estimate sizes OPTIMISTICALLY, slightly under the observed
// average, and that is safe on purpose: since the deadline stopped waiting
// for stragglers, an oversized batch costs only its unfinished tail — every
// finished note still submits. An undersized batch costs real notes, because
// capacity (~50/day at the 2.5-minute sizing) sits below the ~65/day cap X
// currently grants us. When over- and under-shooting have asymmetric prices,
// size toward the cheap mistake.
const EST_WALL_MS_PER_POST = 1.75 * 60 * 1000;

// The misinfo pre-pass processes its finds through the full pipeline before
// the regular pass gets the clock, so a heavy misinfo run used to starve the
// regular batch. Its processing now stops at this sub-deadline; the crawl and
// the selection judge run before it and are quick. Regular posts get whatever
// the pre-pass leaves, which this floor keeps at ~15 of the 22 minutes.
const MISINFO_PROCESSING_BUDGET_MS = 7 * 60 * 1000;

async function main() {
  try {
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

    // Clear the in_progress rows left behind by an earlier run that was killed
    // before it could finalize them. The workflow's concurrency group stops two
    // runs from overlapping, so this can never sweep a live run's rows.
    if (supabaseLogger) {
      try {
        const swept = await supabaseLogger.sweepStuckRuns({ olderThanMinutes: 30 });
        if (swept > 0) console.log(`[pipeline] Swept ${swept} stuck in_progress run(s)`);
      } catch (err) {
        console.warn("[pipeline] Sweeper failed (continuing anyway):", err);
      }
    }

    let { maxPosts } = isLocal
      ? { maxPosts: MAX_POSTS_LOCAL }
      : supabaseLogger
        ? await computeMaxPosts(supabaseLogger)
        : { maxPosts: MAX_POSTS_FALLBACK };

    // At this point we would skip the run because the writing limit is reached.
    // X's cap may have risen since it last rejected us. So once the cooldown has
    // elapsed we probe it. We nudge the limit up by one and work out the budget
    // again, so that we attempt a note instead of skipping outright.
    if (maxPosts === 0 && supabaseLogger) {
      const probed = await probeWritingLimitAfterCooldown(supabaseLogger);
      if (probed) ({ maxPosts } = await computeMaxPosts(supabaseLogger));
    }

    if (maxPosts === 0) {
      console.log("[pipeline] Skipping — writing limit reached for the current 24h window");
      clearTimeout(globalTimeout);
      await closeBrowser();
      process.exit(0);
    }

    // With --local we collect the per-tweet results into a CSV and open the
    // dashboard on them afterwards.
    const localOutput: OutputFolder | null = isLocal
      ? initOutputFolder("pipeline", "run", undefined)
      : null;
    const onTweetProcessed = localOutput
      ? (event: TweetProcessedEvent) => writePipelineRowToCsv(localOutput, event)
      : undefined;

    // Fetch the skip set and the known-tweet set once here. Otherwise the notes,
    // pipeline_runs and tweets tables get scanned twice in a single run.
    let skipPostIds: Set<string> | undefined;
    let knownTweetIds: Set<string> | undefined;
    if (supabaseLogger) {
      try {
        [skipPostIds, knownTweetIds] = await Promise.all([
          supabaseLogger.getSkipTweetIds(),
          supabaseLogger.getKnownTweetIds(),
        ]);
      } catch (err) {
        console.warn("[pipeline] Failed to pre-fetch skip/known sets (the pipeline will fetch its own):", err);
      }
    }

    // Track every tweet a pre-pass processes. The known-tweet set above was
    // snapshotted before the pre-passes ran, so without this the regular pass
    // could process the same tweet a second time within one run. knownTweetIds
    // is undefined when the pre-fetch failed. That case heals itself, because
    // fetchPosts then queries the database again after the pre-passes have
    // written their new tweets with bulkInsertNewTweets.
    const trackPrePassProcessed = (event: TweetProcessedEvent) => {
      knownTweetIds?.add(event.post.id);
      return onTweetProcessed?.(event);
    };

    // The Pangram AI-detection pre-pass over the XXL feed runs first. If it
    // fails we keep an empty candidate list and carry on. A crawl error or a
    // missing Pangram key must never take down regular note-writing. Its
    // candidates and the regular pipeline's candidates share one submit call
    // under the daily cap.
    let pangramCandidates: Candidate[] = [];
    if (PANGRAM_PIPELINE_ENABLED) {
      try {
        pangramCandidates = await generatePangramCandidates(supabaseLogger, {
          skipPostIds: skipPostIds ?? new Set<string>(),
          onTweetProcessed: trackPrePassProcessed,
        });
      } catch (err) {
        console.warn("[pipeline] Pangram pre-pass failed; continuing with regular pipeline only:", err);
      }
    } else {
      console.log("[pipeline] Pangram pre-pass disabled (PANGRAM_PIPELINE_ENABLED=false)");
    }

    // The misinfo-monitoring pre-pass runs next, scoped to
    // MISINFO_ACTIVE_TOPIC_IDS. It fails soft exactly like the Pangram pre-pass.
    // A failure here must never take down regular note-writing. Its candidates
    // also share the single submit call and the daily cap.
    let misinfoCandidates: Candidate[] = [];
    if (MISINFO_PIPELINE_ENABLED) {
      try {
        misinfoCandidates = await generateMisinfoCandidates(supabaseLogger, {
          deadlineMs: Math.min(SOFT_DEADLINE_AT_MS, RUN_STARTED_AT_MS + MISINFO_PROCESSING_BUDGET_MS),
          skipPostIds: skipPostIds ?? new Set<string>(),
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

    const regularCandidates = await generateCandidates(supabaseLogger, {
      maxPosts,
      deadlineMs: SOFT_DEADLINE_AT_MS,
      skipPostIds,
      knownTweetIds,
      onTweetProcessed,
      // Curated-topic matching also runs on the regular pool. A post confirmed
      // to be on topic gets the monitoring treatment and a bounded share of
      // maxPosts. The code for that lives in regularFeedTopicCuration.ts. Pass
      // an empty array to disable it.
      topicIds: MISINFO_ACTIVE_TOPIC_IDS,
    });

    // This array fixes the submission order, because submitCandidates does not
    // re-sort it. Misinfo notes get priority, but only up to a bound. The first
    // few are however many the 24-hour reserve has left, and they arrive already
    // ranked by velocity. Those go ahead of the regular notes. The rest fall in
    // behind them, so a day heavy with topic posts cannot eat the whole daily
    // cap.
    const misinfoReserve = supabaseLogger ? await misinfoReserveRemaining(supabaseLogger) : 0;
    const candidates = [
      ...misinfoCandidates.slice(0, misinfoReserve),
      ...regularCandidates,
      ...misinfoCandidates.slice(misinfoReserve),
      ...pangramCandidates,
    ];
    if (candidates.length > 0 && supabaseLogger) {
      const submitted = await submitCandidates(candidates, supabaseLogger, isLocal);
      console.log(`[pipeline] Submitted ${submitted} of ${candidates.length} candidates (${pangramCandidates.length} pangram, ${misinfoCandidates.length} misinfo, ${regularCandidates.length} regular)`);
    } else {
      console.log(`[pipeline] No candidates to submit`);
    }

    if (localOutput) {
      await autoOpenInDashboard(localOutput.csvPath, buildRunName("pipeline", "local"));
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

if (Object.keys(forcedPicks).length > 0) {
  withForcedPicks(forcedPicks, main);
} else {
  main();
}
