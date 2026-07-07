/**
 * Validate the count-retry fix in src/api/supabaseClient.ts (GPT's change):
 *  1. Timing: HEAD count select=id vs select=* on pipeline_runs
 *  2. Error visibility: HEAD vs GET error bodies (bad column)
 *  3. GET fallback correctness: count with limit(1) matches HEAD count
 *  4. supabase-js behavior on network failure (reject vs error object, status value)
 *  5. End-to-end retry/fallback behavior of SupabaseLogger.runExactCount with injected failures
 *
 * Run: bun run src/scripts_jim/2026_07_04_count_retry_check/experiments.ts
 */
import { createClient } from "@supabase/supabase-js";
import { getSupabaseClient, SupabaseLogger } from "../../api/supabaseClient";

const client = getSupabaseClient();
const SINCE_32H = new Date(Date.now() - 32 * 60 * 60 * 1000).toISOString();
const TIMING_ITERATIONS = 15;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function timeHeadCount(columns: string): Promise<{ times: number[]; failures: number }> {
  const times: number[] = [];
  let failures = 0;
  for (let i = 0; i < TIMING_ITERATIONS; i++) {
    const start = performance.now();
    const { error } = await client
      .from("pipeline_runs")
      .select(columns, { count: "exact", head: true })
      .gte("created_at", SINCE_32H);
    times.push(performance.now() - start);
    if (error) failures++;
  }
  return { times, failures };
}

async function experiment1_timing() {
  console.log("\n=== 1. Timing: HEAD count select=id vs select=* (pipeline_runs, 32h window) ===");
  // warm up
  await client.from("pipeline_runs").select("id", { count: "exact", head: true }).gte("created_at", SINCE_32H);
  const star = await timeHeadCount("*");
  const id = await timeHeadCount("id");
  console.log(`select=*  median=${median(star.times).toFixed(0)}ms  all=[${star.times.map((t) => t.toFixed(0)).join(", ")}]  failures=${star.failures}`);
  console.log(`select=id median=${median(id.times).toFixed(0)}ms  all=[${id.times.map((t) => t.toFixed(0)).join(", ")}]  failures=${id.failures}`);
}

async function experiment2_errorVisibility() {
  console.log("\n=== 2. Error bodies: HEAD vs GET with a nonexistent column ===");
  const head = await client.from("pipeline_runs").select("nonexistent_col", { count: "exact", head: true }).limit(1);
  console.log("HEAD error:", JSON.stringify({ status: head.status, error: head.error }));
  const get = await client.from("pipeline_runs").select("nonexistent_col", { count: "exact" }).limit(1);
  console.log("GET  error:", JSON.stringify({ status: get.status, error: get.error }));
}

async function experiment3_fallbackCorrectness() {
  console.log("\n=== 3. GET-with-limit(1) count matches HEAD count ===");
  const head = await client.from("pipeline_runs").select("id", { count: "exact", head: true }).gte("created_at", SINCE_32H);
  const get = await client.from("pipeline_runs").select("id", { count: "exact" }).gte("created_at", SINCE_32H).limit(1);
  console.log(`HEAD count=${head.count}  GET(limit 1) count=${get.count}  rows returned=${(get.data ?? []).length}`);
  const zeroRows = await client
    .from("pipeline_runs")
    .select("id", { count: "exact" })
    .gte("created_at", "2099-01-01")
    .limit(1);
  console.log(`GET on empty window: count=${zeroRows.count} error=${JSON.stringify(zeroRows.error)}`);
}

async function experiment4_networkFailure() {
  console.log("\n=== 4. supabase-js on unreachable host: reject or resolve? ===");
  const badClient = createClient("https://nonexistent-project-xyz.supabase.co", "fake-key", {
    auth: { persistSession: false },
  });
  try {
    const result = await badClient.from("pipeline_runs").select("id", { count: "exact", head: true });
    console.log("RESOLVED with:", JSON.stringify({ status: result.status, count: result.count, error: result.error }));
  } catch (err: any) {
    console.log("REJECTED with:", err?.constructor?.name, "-", err?.message, "status:", err?.status);
  }
}

async function experiment5_runExactCountBehavior() {
  console.log("\n=== 5. runExactCount end-to-end with injected failures ===");
  const logger = new SupabaseLogger();
  const runExactCount = (logger as any).runExactCount.bind(logger);

  let calls = 0;
  const failTwiceThenSucceed = async () => {
    calls++;
    if (calls <= 2) return { count: null, error: { message: "" }, status: 500 };
    return { count: 42, error: null, status: 200 };
  };
  console.log("-- transient 500 twice, then success:");
  console.log("   result:", await runExactCount(failTwiceThenSucceed, "test-transient"));

  console.log("-- non-retryable 400 HEAD, GET fallback recovering:");
  const result400 = await runExactCount(
    async (head: boolean) =>
      head
        ? { count: null, error: { message: "bad request", code: "42703" }, status: 400 }
        : { count: 7, error: null, status: 200 },
    "test-400",
  );
  console.log("   result:", result400);

  console.log("-- always-500 HEAD, GET fallback also fails (real error surfaced):");
  const resultAllFail = await runExactCount(
    async (head: boolean) =>
      head
        ? { count: null, error: { message: "" }, status: 500 }
        : { count: null, error: { message: "canceling statement due to statement timeout", code: "57014" }, status: 500 },
    "test-all-fail",
  );
  console.log("   result:", resultAllFail);

  console.log("-- thrown exception from query (network-level):");
  const resultThrow = await runExactCount(
    async (head: boolean) => {
      if (head) throw new TypeError("fetch failed");
      return { count: 9, error: null, status: 200 };
    },
    "test-throw",
  );
  console.log("   result:", resultThrow);
}

await experiment1_timing();
await experiment2_errorVisibility();
await experiment3_fallbackCorrectness();
await experiment4_networkFailure();
await experiment5_runExactCountBehavior();
console.log("\nDone.");
process.exit(0);
