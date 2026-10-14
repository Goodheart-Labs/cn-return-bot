import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseSubmissionCapacity } from "../pipeline/capacity/submissionReserve";
import { buildPipelineHealth, type HealthCapacity, type HealthRun, type PipelineHealth } from "./src/lib/health";

const DAY_MS = 86_400_000;
const AUTOMATIC_RUNS = "bot_name.is.null,bot_name.neq.signal";
const RUN_COLUMNS = "id,tweet_id,created_at,outcome,outcome_reason,final_stage,commit_sha";
const HEALTH_COLUMNS = [
  RUN_COLUMNS,
  "prefilter_elapsed_ms:logs->note_prefilter_steps->>elapsedMs",
  "prefilter_timeout:logs->note_prefilter_steps->timeout->>action",
].join(",");

export function createHealthClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for live pipeline health.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, { ...init, signal: AbortSignal.timeout(25_000) }),
      { preconnect: fetch.preconnect },
    ) },
  });
}

async function loadCapacity(client: SupabaseClient): Promise<{ capacity: HealthCapacity | null; issue?: PipelineHealth["capacityIssue"] }> {
  try {
    const { data, error } = await client.rpc("get_note_submission_capacity");
    if (error) return { capacity: null, issue: "unavailable" };
    if (data && typeof data.reserve === "number" && data.reserve > 0 && data.canSubmit === undefined) {
      return { capacity: null, issue: "legacy_reserve" };
    }
    const { canSubmit, signalQueued, inFlight, used24h, nextAttemptAt, probe } = parseSubmissionCapacity(data);
    return { capacity: { canSubmit, signalQueued, inFlight, used24h, nextAttemptAt, probe } };
  } catch {
    return { capacity: null, issue: "unavailable" };
  }
}

async function loadRecentRuns(client: SupabaseClient, since: string, until: string, inclusiveEnd: boolean, timings = false): Promise<HealthRun[]> {
  const runs: HealthRun[] = [];
  const pageSize = timings ? 200 : 1000;
  let cursor: HealthRun | undefined;
  while (true) {
    let query = client.from("pipeline_runs").select(timings ? HEALTH_COLUMNS : RUN_COLUMNS)
      .or(AUTOMATIC_RUNS).gte("created_at", since)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize);
    query = inclusiveEnd ? query.lte("created_at", until) : query.lt("created_at", until);
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error) throw new Error("Could not read recent pipeline health.");
    const page = data as unknown as HealthRun[];
    runs.push(...page);
    if (page.length < pageSize) return runs;
    cursor = page[page.length - 1]!;
  }
}

export async function loadPipelineHealth(client: SupabaseClient, asOf = new Date()): Promise<PipelineHealth> {
  const until = asOf.toISOString();
  const overdueBefore = new Date(asOf.getTime() - 30 * 60_000).toISOString();
  const [runs, timings, lastAttempt, lastSubmission, overdue, capacity] = await Promise.all([
    Promise.all(Array.from({ length: 4 }, (_, index) => loadRecentRuns(client,
      new Date(asOf.getTime() - (index + 1) * 2 * DAY_MS).toISOString(),
      new Date(asOf.getTime() - index * 2 * DAY_MS).toISOString(), index === 0,
    ))).then((parts) => parts.flat()),
    loadRecentRuns(client, new Date(asOf.getTime() - DAY_MS).toISOString(), until, true, true),
    client.from("pipeline_runs").select("created_at").or(AUTOMATIC_RUNS)
      .lte("created_at", until).order("created_at", { ascending: false }).limit(1),
    client.from("notes").select("submitted_at").not("submitted_at", "is", null)
      .lte("submitted_at", until).order("submitted_at", { ascending: false }).limit(1),
    client.from("pipeline_runs").select("id", { count: "exact", head: true })
      .or(AUTOMATIC_RUNS).eq("outcome", "in_progress").lte("created_at", overdueBefore),
    loadCapacity(client),
  ]);
  if (lastAttempt.error || lastSubmission.error || overdue.error || overdue.count === null) {
    throw new Error("Could not read pipeline activity and unfinished-attempt counts.");
  }
  const timingsById = new Map(timings.map((run) => [run.id, run]));
  const safeRuns = runs.map((run) => ({ ...run,
    prefilter_elapsed_ms: timingsById.get(run.id)?.prefilter_elapsed_ms ?? null,
    prefilter_timeout: timingsById.get(run.id)?.prefilter_timeout === "fail_open" ? { action: "fail_open" } : null,
  }));
  return { ...buildPipelineHealth({
    runs: safeRuns, asOf,
    latestAttemptAt: lastAttempt.data?.[0]?.created_at ?? null,
    latestSubmissionAt: lastSubmission.data?.[0]?.submitted_at ?? null,
    overdueTotal: overdue.count,
    capacity: capacity.capacity,
  }), capacityIssue: capacity.issue };
}
