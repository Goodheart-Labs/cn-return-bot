/**
 * Run Pipeline
 *
 * Single-pass pipeline: fetch tweets, generate notes, submit immediately.
 *
 * Runs on GitHub Actions every 15 minutes.
 *
 * Flags:
 *   --local              route Supabase to LOCAL_SUPABASE_URL/KEY; write CSV + auto-open dashboard
 *   --misinfo-only       run ONLY the XXL-feed misinfo pre-pass (skip the regular pipeline).
 *                        Pair with --local to test it: keeps prod X creds for the read-only XXL
 *                        crawl (local creds are small-feed-only) while submission stays a dry run.
 *   --misinfo-dump PATH  source the pre-pass from a JSONL feed dump instead of the live XXL feed
 *                        (which 403s outside GitHub Actions). Lets you test it on real data locally.
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

function takeFlagValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isLocal = process.argv.includes("--local");
const misinfoOnly = process.argv.includes("--misinfo-only");
const misinfoDumpPath = takeFlagValue("--misinfo-dump");
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
  // imports read these). EXCEPTION: --misinfo-only needs prod *read* access to
  // crawl the XXL feed (local creds are small-feed-only). Submission is a dry
  // run under --local, so the prod keys are only ever used for reads here.
  if (misinfoOnly) {
    console.log("[pipeline] --misinfo-only: keeping prod X creds for the read-only XXL crawl (submission is dry-run under --local)");
  } else {
    for (const [src, dest] of Object.entries({
      LOCAL_X_API_KEY: "X_API_KEY",
      LOCAL_X_API_KEY_SECRET: "X_API_KEY_SECRET",
      LOCAL_X_ACCESS_TOKEN: "X_ACCESS_TOKEN",
      LOCAL_X_ACCESS_TOKEN_SECRET: "X_ACCESS_TOKEN_SECRET",
    })) {
      if (process.env[src]) process.env[dest] = process.env[src];
    }
  }
}

import { SupabaseLogger } from "../api/supabaseClient";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { generateCandidates, type TweetProcessedEvent } from "../pipeline/orchestration/generateCandidates";
import { generateMisinfoCandidates } from "../pipeline/misinfo-monitoring/generateMisinfoCandidates";
import { submitCandidates } from "../pipeline/orchestration/submitCandidates";
import { computeMaxPosts } from "../pipeline/orchestration/computeMaxPosts";
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

// 22.5 min: the serial misinfo pre-pass now runs before the regular pipeline,
// so the same deadline has to cover both. The GH Actions job timeout (30 min)
// sits above this so the watchdog, not the runner kill, is the normal exit.
const MAX_RUNTIME_MS = 22.5 * 60 * 1000;
const MAX_POSTS_LOCAL = 5;
const MAX_POSTS_FALLBACK = 5;

const globalTimeout = setTimeout(async () => {
  console.log("[pipeline] Maximum runtime reached (22.5 minutes), forcing exit");
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

    // 30 min comfortably exceeds the 15 min job timeout.
    if (supabaseLogger) {
      try {
        const swept = await supabaseLogger.sweepStuckRuns({ olderThanMinutes: 30 });
        if (swept > 0) console.log(`[pipeline] Swept ${swept} stuck in_progress run(s)`);
      } catch (err) {
        console.warn("[pipeline] Sweeper failed (continuing anyway):", err);
      }
    }

    // --misinfo-only skips the regular pipeline, so the daily-writing-limit
    // gate (which only governs that pass) doesn't apply.
    const maxPosts = misinfoOnly
      ? 0
      : isLocal
        ? MAX_POSTS_LOCAL
        : supabaseLogger
          ? await computeMaxPosts(supabaseLogger)
          : MAX_POSTS_FALLBACK;

    if (!misinfoOnly && maxPosts === 0) {
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

    // Pre-fetch the skip/known sets ONCE and share them with both passes so
    // notes/pipeline_runs/tweets aren't scanned twice per run. knownTweetIds is
    // only used by the regular pass, so --misinfo-only skips that read.
    let skipPostIds: Set<string> | undefined;
    let knownTweetIds: Set<string> | undefined;
    if (supabaseLogger) {
      try {
        if (misinfoOnly) {
          skipPostIds = await supabaseLogger.getSkipTweetIds();
        } else {
          [skipPostIds, knownTweetIds] = await Promise.all([
            supabaseLogger.getSkipTweetIds(),
            supabaseLogger.getKnownTweetIds(),
          ]);
        }
      } catch (err) {
        console.warn("[pipeline] Failed to pre-fetch skip/known sets (each pass will fetch its own):", err);
      }
    }

    // Misinfo pre-pass runs first so its candidates are submitted ahead of the
    // regular pipeline's under the daily cap. Fail-soft to [] when the XXL crawl
    // can't run (e.g. local creds are small-feed-only).
    const misinfoCandidates = await generateMisinfoCandidates(supabaseLogger, {
      skipPostIds: skipPostIds ?? new Set<string>(),
      onTweetProcessed,
      dumpPath: misinfoDumpPath,
    });

    const regularCandidates = misinfoOnly
      ? []
      : await generateCandidates(supabaseLogger, {
          maxPosts,
          skipPostIds,
          knownTweetIds,
          onTweetProcessed,
        });

    const candidates = [...misinfoCandidates, ...regularCandidates];
    if (candidates.length > 0 && supabaseLogger) {
      const submitted = await submitCandidates(candidates, supabaseLogger, isLocal);
      console.log(`[pipeline] Submitted ${submitted} of ${candidates.length} candidates (${misinfoCandidates.length} misinfo, ${regularCandidates.length} regular)`);
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
