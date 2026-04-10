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

    // Update writing limit from X API (disabled — doesn't work properly)
    // if (supabaseLogger) {
    //   await updateWritingLimit(supabaseLogger);
    // }

    const candidates = await generateCandidates(supabaseLogger, { maxPosts: isLocal ? MAX_POSTS_LOCAL : MAX_POSTS });

    if (candidates.length > 0 && supabaseLogger) {
      const submitted = await submitCandidates(candidates, supabaseLogger, isLocal);
      console.log(`[pipeline] Submitted ${submitted} of ${candidates.length} candidates`);
    } else {
      console.log(`[pipeline] No candidates to submit`);
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
