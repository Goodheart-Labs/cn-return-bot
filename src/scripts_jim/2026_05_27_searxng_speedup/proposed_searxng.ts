/**
 * PROPOSED replacement for src/pipeline/tool-calling/searxng.ts.
 *
 * Differences from current:
 *   - Multi-provider PRIORITY CYCLE (google → duckduckgo → brave by default)
 *     instead of single-engine "wait 185s and retry."
 *   - Per-engine PQueue with a 4s inter-query gap. Each engine has its own
 *     queue, so falling to a fallback doesn't block on a separate engine's
 *     rate-limiter.
 *   - On per-engine suspension, mark the engine and skip it — do NOT wait.
 *     The CYCLE will fall to the next engine. Suspension is "respected" in
 *     the sense that we stop hitting that engine for 185s; we just don't
 *     pause the whole pipeline for it.
 *   - WAIT only when EVERY engine in the cycle is in cool-down (rare).
 *
 * Config:
 *   SEARXNG_PROVIDERS — comma-separated priority list. Default
 *     "google,duckduckgo,brave". Set to "google" to force google-only.
 *   SEARXNG_INTERVAL_MS — per-engine inter-query gap. Default 4000.
 */

import PQueue from "p-queue";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";
const PROVIDERS = (process.env.SEARXNG_PROVIDERS ?? "google,duckduckgo,brave")
  .split(",").map((s) => s.trim()).filter(Boolean);
const PER_ENGINE_INTERVAL_MS = Number(process.env.SEARXNG_INTERVAL_MS) || 4_000;
const DEFAULT_MAX_RESULTS = 10;
const SUSPENSION_BUFFER_MS = 5_000;
const DEFAULT_SUSPENSION_S = 180;
// Used when an engine returns 0 with no /stats/errors suspended_time —
// canary probe says it's broken but SearXNG hasn't logged a duration. Shorter
// than 180s so we recheck this engine sooner if it might recover.
const SILENT_FAILURE_COOLDOWN_S = 60;
const CANARY_QUERY = "wikipedia";
const FETCH_TIMEOUT_MS = 15_000;
const STATS_TIMEOUT_MS = 5_000;

export interface SearxngResult {
  title: string;
  url: string;
  content: string;
  publishedDate: string | null;
}

interface SearxngStatsError {
  exception_classname: string;
  log_parameters: string[];
  percentage: number;
}

interface RawSearchResponse {
  results: SearxngResult[];
  unresponsive_engines: unknown[];
}

interface EngineState {
  queue: PQueue;
  suspendedUntil: number;
  inflightSuspensionCheck: Promise<void> | null;
}

const engineStates = new Map<string, EngineState>();

function getEngineState(engine: string): EngineState {
  let s = engineStates.get(engine);
  if (!s) {
    s = {
      queue: new PQueue({ concurrency: 1, interval: PER_ENGINE_INTERVAL_MS, intervalCap: 1 }),
      suspendedUntil: 0,
      inflightSuspensionCheck: null,
    };
    engineStates.set(engine, s);
  }
  return s;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseSuspendedTimeSeconds(errs: SearxngStatsError[]): number {
  let max = 0;
  for (const e of errs) {
    for (const p of e.log_parameters ?? []) {
      const m = /suspended_time=(\d+)/.exec(p);
      if (m) max = Math.max(max, parseInt(m[1]!, 10));
    }
  }
  return max;
}

async function getEngineSuspensions(): Promise<Map<string, number>> {
  try {
    const resp = await fetch(`${SEARXNG_URL}/stats/errors`, { signal: AbortSignal.timeout(STATS_TIMEOUT_MS) });
    if (!resp.ok) return new Map();
    const data: Record<string, SearxngStatsError[]> = await resp.json();
    const out = new Map<string, number>();
    for (const [eng, errs] of Object.entries(data)) {
      const secs = parseSuspendedTimeSeconds(errs);
      if (secs > 0) out.set(eng, secs);
    }
    return out;
  } catch { return new Map(); }
}

async function rawFetch(query: string, engine: string): Promise<SearxngResult[]> {
  const endpoint = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&engines=${engine}`;
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CommunityNotesBot/1.0)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
  const data: RawSearchResponse = await response.json();
  const seen = new Set<string>();
  const out: SearxngResult[] = [];
  for (const r of data.results ?? []) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push({
      title: r.title ?? "",
      url: r.url,
      content: r.content ?? "",
      publishedDate: r.publishedDate ?? null,
    });
    if (out.length >= DEFAULT_MAX_RESULTS) break;
  }
  return out;
}

function markSuspended(engine: string, secs: number): void {
  const state = getEngineState(engine);
  const until = Date.now() + secs * 1000 + SUSPENSION_BUFFER_MS;
  if (until > state.suspendedUntil) {
    state.suspendedUntil = until;
    console.log(`[searxng] engine=${engine} suspended for ${secs}s; cycle will skip it until cool-down`);
  }
}

async function checkAndMarkSuspension(engine: string): Promise<void> {
  // Deduped: 5 simultaneous zero-result callers run ONE check.
  const state = getEngineState(engine);
  if (state.inflightSuspensionCheck) return state.inflightSuspensionCheck;
  const p = (async () => {
    try {
      const suspensions = await getEngineSuspensions();
      const reported = suspensions.get(engine) ?? 0;
      if (reported > 0) { markSuspended(engine, reported); return; }
      // SearXNG didn't log a suspended_time — canary to disambiguate "engine
      // broken" from "this specific query has 0 real hits".
      const canary = await rawFetch(CANARY_QUERY, engine).catch(() => [] as SearxngResult[]);
      if (canary.length === 0) markSuspended(engine, SILENT_FAILURE_COOLDOWN_S);
    } finally { state.inflightSuspensionCheck = null; }
  })();
  state.inflightSuspensionCheck = p;
  return p;
}

function pickAvailableEngine(providers: string[]): string | null {
  const now = Date.now();
  for (const e of providers) {
    if (getEngineState(e).suspendedUntil <= now) return e;
  }
  return null;
}

function soonestRecoveryMs(providers: string[]): number {
  const now = Date.now();
  let soonest = Infinity;
  for (const e of providers) {
    const until = getEngineState(e).suspendedUntil;
    if (until > now) soonest = Math.min(soonest, until - now);
  }
  return soonest === Infinity ? 0 : soonest;
}

/**
 * Suspension-aware multi-provider SearXNG fetch.
 *
 * Behavior:
 *   1. Walk the provider list in priority order.
 *   2. Skip engines whose cool-down hasn't expired.
 *   3. Fire the query at the first available engine through its per-engine
 *      rate-limit queue. If it returns >0 results, done.
 *   4. If 0 results, mark the engine (canary / /stats/errors) and continue
 *      to the next provider — do NOT wait.
 *   5. If every provider is in cool-down, sleep until the soonest recovery
 *      (the only place we ever wait), then restart at provider 1.
 *   6. Two full passes max — give up and return [] if still nothing.
 *
 * The opts.engines override (if provided) replaces the env-driven priority
 * list. Single-engine usage e.g. `{ engines: "google" }` degrades gracefully
 * to "try google, if suspended wait, retry."
 */
export async function fetchSearxngResults(
  query: string,
  opts: { engines?: string } = {},
): Promise<SearxngResult[]> {
  const providers = opts.engines
    ? opts.engines.split(",").map((s) => s.trim()).filter(Boolean)
    : PROVIDERS;

  for (let pass = 0; pass < 2; pass++) {
    while (true) {
      const engine = pickAvailableEngine(providers);
      if (!engine) break;
      const state = getEngineState(engine);
      const results = (await state.queue.add(() => rawFetch(query, engine).catch(() => [] as SearxngResult[])))!;
      if (results.length > 0) return results;
      await checkAndMarkSuspension(engine);
    }
    const waitMs = soonestRecoveryMs(providers);
    if (waitMs <= 0) break;
    console.log(`[searxng] all providers in cool-down; waiting ${(waitMs / 1000).toFixed(0)}s`);
    await sleep(waitMs);
  }
  return [];
}

export function formatSearxngResults(results: SearxngResult[]): string {
  if (results.length === 0) return "No results.";
  return results
    .map((r, i) => {
      const dateLine = r.publishedDate ? `\n   Published: ${r.publishedDate}` : "";
      return `${i + 1}. ${r.title}${dateLine}\n   ${r.url}\n   ${r.content}`;
    })
    .join("\n\n");
}
