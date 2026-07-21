/**
 * Run Pipeline
 *
 * Single-pass pipeline: fetch tweets, generate notes, submit immediately.
 *
 * Runs on GitHub Actions every 30 minutes.
 *
 * Flags:
 *   --local              route Supabase to LOCAL_SUPABASE_URL/KEY; write CSV + auto-open dashboard
 *   --pick test=variant  force a specific A/B test variant (repeatable). The bot itself
 *                        is picked by the "bot" test, so use --pick bot=<id> to force it.
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

  // Route X API calls to the local test account (must happen before any X API
  // imports read these).
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
import { submitCandidates, type Candidate } from "../pipeline/orchestration/submitCandidates";
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

// 27 min: the 30-min cron gives each run this much wall clock without overlapping
// the next tick. The GH Actions job timeout (35 min) sits above this — plus
// multi-minute setup — so the watchdog (clean exit), not the runner kill, is the
// normal stop.
const MAX_RUNTIME_MS = 27 * 60 * 1000;
const MAX_POSTS_LOCAL = 5;
const MAX_POSTS_FALLBACK = 5;

// Flip to true to re-enable the XXL-feed Pangram AI-detection pre-pass.
const PANGRAM_PIPELINE_ENABLED = false;

// Activates the misinfo-monitoring pre-pass for the topics below ONLY (not the
// evergreen topics). A live run writes AND submits real notes to X; flip to
// false to kill-switch it.
const MISINFO_PIPELINE_ENABLED = true;
const MISINFO_ACTIVE_TOPIC_IDS: MisinfoTopicId[] = ["trump_election_security"];

const globalTimeout = setTimeout(async () => {
  console.log("[pipeline] Maximum runtime reached (27 minutes), forcing exit");
  await closeBrowser();
  process.exit(0);
}, MAX_RUNTIME_MS);

async function main() {
  try {
    // Initialize Supabase logger
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

    // Clear in_progress rows abandoned by a prior run that was killed before
    // finalizing them. Concurrency prevents overlapping runs, so this never
    // sweeps a live run's rows.
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

    // We'd skip (writing limit reached), but X's cap may have risen since it last
    // rejected us. If the cooldown has elapsed, probe by nudging the limit up 1
    // and re-budgeting, so we attempt a note instead of skipping outright.
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

    // --local: collect per-tweet results into a CSV and auto-open the dashboard
    const localOutput: OutputFolder | null = isLocal
      ? initOutputFolder("pipeline", "run", undefined)
      : null;
    const onTweetProcessed = localOutput
      ? (event: TweetProcessedEvent) => writePipelineRowToCsv(localOutput, event)
      : undefined;

    // Pre-fetch the skip/known sets ONCE so notes/pipeline_runs/tweets aren't
    // scanned twice per run.
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

    // XXL-feed Pangram AI-detection pre-pass runs first. Fail-soft to []: a
    // pre-pass failure (crawl error, missing Pangram key, etc.) must never take
    // down regular note-writing. Its candidates and the regular pipeline's share
    // one submit call under the daily cap.
    let pangramCandidates: Candidate[] = [];
    if (PANGRAM_PIPELINE_ENABLED) {
      try {
        pangramCandidates = await generatePangramCandidates(supabaseLogger, {
          skipPostIds: skipPostIds ?? new Set<string>(),
          onTweetProcessed,
        });
      } catch (err) {
        console.warn("[pipeline] Pangram pre-pass failed; continuing with regular pipeline only:", err);
      }
    } else {
      console.log("[pipeline] Pangram pre-pass disabled (PANGRAM_PIPELINE_ENABLED=false)");
    }

    // Misinfo-monitoring pre-pass, scoped to MISINFO_ACTIVE_TOPIC_IDS. Same
    // fail-soft contract as Pangram: a pre-pass failure must never take down
    // regular note-writing; its candidates share the one submit call / daily cap.
    let misinfoCandidates: Candidate[] = [];
    if (MISINFO_PIPELINE_ENABLED) {
      try {
        misinfoCandidates = await generateMisinfoCandidates(supabaseLogger, {
          skipPostIds: skipPostIds ?? new Set<string>(),
          onTweetProcessed,
          topicIds: MISINFO_ACTIVE_TOPIC_IDS,
        });
      } catch (err) {
        console.warn("[pipeline] Misinfo pre-pass failed; continuing with regular pipeline only:", err);
      }
    } else {
      console.log("[pipeline] Misinfo pre-pass disabled (MISINFO_PIPELINE_ENABLED=false)");
    }

    const regularCandidates = await generateCandidates(supabaseLogger, {
      maxPosts,
      skipPostIds,
      knownTweetIds,
      onTweetProcessed,
    });

    const candidates = [...pangramCandidates, ...misinfoCandidates, ...regularCandidates];
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
