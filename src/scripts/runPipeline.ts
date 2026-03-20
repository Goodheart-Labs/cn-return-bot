/**
 * Run Pipeline
 *
 * Orchestrator for the two-phase pipeline:
 * 1. Generate candidates — write notes for new tweets, store as candidates
 * 2. Submit candidates — rank stored candidates, submit the best ones
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
import { closeBrowser } from "../pipeline/browserManager";
import { generateCandidates } from "./generateCandidates";
import { submitCandidates } from "./submitCandidates";

const MAX_RUNTIME_MS = 15 * 60 * 1000; // 15 minutes

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

    // Phase 1: Generate candidates
    console.log("[pipeline] === Phase 1: Generate Candidates ===");
    await generateCandidates(supabaseLogger);

    // Phase 2: Submit best candidates
    console.log("[pipeline] === Phase 2: Submit Candidates ===");
    await submitCandidates(supabaseLogger);

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
