/**
 * Run Pipeline
 *
 * Single-pass pipeline: fetch tweets, generate notes, submit immediately.
 *
 * Runs on GitHub Actions every 15 minutes.
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

  // Route X API calls to the local test account (must happen before any X API imports read these)
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

const MAX_RUNTIME_MS = 15 * 60 * 1000; // 15 minutes
const MAX_POSTS_LOCAL = 5;
const MAX_POSTS_FALLBACK = 5;

const globalTimeout = setTimeout(async () => {
  console.log("[pipeline] Maximum runtime reached (15 minutes), forcing exit");
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

    const maxPosts = isLocal
      ? MAX_POSTS_LOCAL
      : supabaseLogger
        ? await computeMaxPosts(supabaseLogger)
        : MAX_POSTS_FALLBACK;

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

    const candidates = await generateCandidates(supabaseLogger, { maxPosts, onTweetProcessed });
    if (candidates.length > 0 && supabaseLogger) {
      const submitted = await submitCandidates(candidates, supabaseLogger, isLocal);
      console.log(`[pipeline] Submitted ${submitted} of ${candidates.length} candidates`);
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
