/**
 * Run Pipeline
 *
 * Single-pass pipeline: fetch tweets, generate notes, submit immediately.
 *
 * Runs on GitHub Actions every 15 minutes.
 * Use --local to route Supabase to a local instance via LOCAL_SUPABASE_URL/KEY.
 */

const isLocal = process.argv.includes("--local");
if (isLocal) {
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
import { generateCandidates } from "../pipeline/orchestration/generateCandidates";
import { submitCandidates } from "../pipeline/orchestration/submitCandidates";
// import { updateWritingLimit } from "../pipeline/orchestration/updateWritingLimit";

const MAX_RUNTIME_MS = 15 * 60 * 1000; // 15 minutes
const MAX_POSTS = 20;
const MAX_POSTS_LOCAL = 5;
const PROBE_POSTS = 3;

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
    if (supabaseLogger) {
      const limitHitAt = await supabaseLogger.getPipelineState("limit_hit_at");
      if (limitHitAt) {
        const hasSubmitted = await supabaseLogger.hasSubmissionsSince(limitHitAt);
        cautious = !hasSubmitted;
        if (cautious) console.log(`[pipeline] Cautious mode — limit hit at ${limitHitAt}, no submissions since`);
      }
    }

    const maxPosts = isLocal ? MAX_POSTS_LOCAL : MAX_POSTS;

    if (cautious && supabaseLogger) {
      // Probe in small batches until we get a submission through (limit reset) or confirm it's still active
      let totalSubmitted = 0;
      let postsUsed = 0;

      while (postsUsed < maxPosts) {
        const batchSize = Math.min(PROBE_POSTS, maxPosts - postsUsed);
        console.log(`[pipeline] Probing batch ${Math.floor(postsUsed / PROBE_POSTS) + 1} (${batchSize} tweets)...`);
        const candidates = await generateCandidates(supabaseLogger, { maxPosts: batchSize });
        postsUsed += batchSize;

        if (candidates.length === 0) continue;

        const submitted = await submitCandidates(candidates, supabaseLogger, isLocal);
        totalSubmitted += submitted;

        if (submitted > 0) {
          // Limit has reset — continue with a normal batch for the rest
          console.log(`[pipeline] Limit reset confirmed — continuing with full batch`);
          const remaining = maxPosts - postsUsed;
          if (remaining > 0) {
            const moreCandidates = await generateCandidates(supabaseLogger, { maxPosts: remaining });
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
      const candidates = await generateCandidates(supabaseLogger, { maxPosts });
      if (candidates.length > 0 && supabaseLogger) {
        const submitted = await submitCandidates(candidates, supabaseLogger, isLocal);
        console.log(`[pipeline] Submitted ${submitted} of ${candidates.length} candidates`);
      } else {
        console.log(`[pipeline] No candidates to submit`);
      }
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

main();
