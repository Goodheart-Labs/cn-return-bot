/**
 * Run Pipeline
 *
 * Single-pass pipeline: fetch tweets, generate notes, submit immediately.
 *
 * Runs on GitHub Actions every 15 minutes.
 *
 * Flags:
 *   --local                 route Supabase to LOCAL_SUPABASE_URL/KEY; write CSV + auto-open dashboard
 *   --bot <id>              force a specific bot (skip random selection)
 *   --config-name <name>    force a BotConfig variant
 */

import { captureProdSupabaseCreds } from "../local/prodSupabaseCreds";

function takeFlagValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

const isLocal = process.argv.includes("--local");
const forcedBotId = takeFlagValue("--bot");
const forcedConfigName = takeFlagValue("--config-name");
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
}

import { SupabaseLogger } from "../api/supabaseClient";
import { closeBrowser } from "../pipeline/utils/browserManager";
import { generateCandidates, type TweetProcessedEvent } from "../pipeline/orchestration/generateCandidates";
import { submitCandidates } from "../pipeline/orchestration/submitCandidates";
import { buildRunName, initOutputFolder, resultToCsvRow, type OutputFolder } from "../local/outputWriter";
import { autoOpenInDashboard } from "../local/dashboardAutoOpen";
import { withConfigOverrides } from "../pipeline/utils/botConfig";
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
const MAX_POSTS = 20;
const MAX_POSTS_LOCAL = 5;
const PROBE_POSTS = 3;
const CAUTIOUS_MODE_ENABLED = false;

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

    // Check if we need to probe first (last run hit the daily limit and no submissions since)
    let cautious = false;
    if (CAUTIOUS_MODE_ENABLED && supabaseLogger) {
      const limitHitAt = await supabaseLogger.getPipelineState("limit_hit_at");
      if (limitHitAt) {
        const hasSubmitted = await supabaseLogger.hasSubmissionsSince(limitHitAt);
        cautious = !hasSubmitted;
        if (cautious) console.log(`[pipeline] Cautious mode — limit hit at ${limitHitAt}, no submissions since`);
      }
    }

    const maxPosts = isLocal ? MAX_POSTS_LOCAL : MAX_POSTS;

    // --local: collect per-tweet results into a CSV and auto-open the dashboard
    const localOutput: OutputFolder | null = isLocal
      ? initOutputFolder("pipeline", "run", undefined)
      : null;
    const onTweetProcessed = localOutput
      ? (event: TweetProcessedEvent) => writePipelineRowToCsv(localOutput, event)
      : undefined;

    if (cautious && supabaseLogger) {
      // Probe in small batches until we get a submission through (limit reset) or confirm it's still active
      let totalSubmitted = 0;
      let postsUsed = 0;

      while (postsUsed < maxPosts) {
        const batchSize = Math.min(PROBE_POSTS, maxPosts - postsUsed);
        console.log(`[pipeline] Probing batch ${Math.floor(postsUsed / PROBE_POSTS) + 1} (${batchSize} tweets)...`);
        const candidates = await generateCandidates(supabaseLogger, { maxPosts: batchSize, onTweetProcessed, forcedBotId });
        postsUsed += batchSize;

        if (candidates.length === 0) continue;

        const submitted = await submitCandidates(candidates, supabaseLogger, isLocal);
        totalSubmitted += submitted;

        if (submitted > 0) {
          // Limit has reset — continue with a normal batch for the rest
          console.log(`[pipeline] Limit reset confirmed — continuing with full batch`);
          const remaining = maxPosts - postsUsed;
          if (remaining > 0) {
            const moreCandidates = await generateCandidates(supabaseLogger, { maxPosts: remaining, onTweetProcessed, forcedBotId });
            if (moreCandidates.length > 0) {
              totalSubmitted += await submitCandidates(moreCandidates, supabaseLogger, isLocal);
            }
          }
          break;
        } else {
          // Had candidates but couldn't submit — limit still active
          console.log(`[pipeline] Limit still active — stopping`);
          break;
        }
      }

      console.log(`[pipeline] Submitted ${totalSubmitted} total`);
    } else {
      // Normal flow
      const candidates = await generateCandidates(supabaseLogger, { maxPosts, onTweetProcessed, forcedBotId });
      if (candidates.length > 0 && supabaseLogger) {
        const submitted = await submitCandidates(candidates, supabaseLogger, isLocal);
        console.log(`[pipeline] Submitted ${submitted} of ${candidates.length} candidates`);
      } else {
        console.log(`[pipeline] No candidates to submit`);
      }
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

if (forcedConfigName) {
  withConfigOverrides({ configName: forcedConfigName }, main);
} else {
  main();
}
