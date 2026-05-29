/**
 * Two families of SearXNG strategies, both designed to ACTUALLY return results
 * (not just to skip fast and return empty). Suspension is real — when an
 * engine returns 0 with a suspended_time marker, we wait it out so the
 * retried query produces evidence the writer can use.
 *
 *  Family B (google-only-tuned):
 *    - Single engine, single rate-limited queue.
 *    - When google trips, wait suspended_time + buffer, retry once.
 *    - Sweep interval ∈ {2s, 3s, 5s, 8s} to find the rate that minimises
 *      wall time without too many trips.
 *
 *  Family C (3-engine cycle):
 *    - Try google → ddg → brave in order. First engine that returns >0
 *      wins; engines in cool-down are skipped (not waited on).
 *    - If ALL three are in cool-down, wait for the soonest recovery
 *      (capped at the engine's suspended_time + buffer).
 *    - Per-engine rate gating so we don't spam any single engine.
 *
 *  All strategies share a common interface for the benchmark harness.
 */

import PQueue from "p-queue";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";
const FETCH_TIMEOUT_MS = 15_000;
const STATS_TIMEOUT_MS = 5_000;
const SUSPENSION_BUFFER_MS = 5_000;
const DEFAULT_SUSPENSION_S = 180;
const CANARY_QUERY = "wikipedia";

export interface FetchResult {
  query: string;
  results: number;
  durationMs: number;
  engineUsed?: string;
  error?: string;
  waitedForSuspensionMs?: number;
}

interface RawResult { url?: string; engines?: string[] }
interface RawResponse {
  results?: RawResult[];
  unresponsive_engines?: unknown[];
}

interface SearxngStatsErr { exception_classname: string; log_parameters?: string[] }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Low-level: one HTTP request to SearXNG
// ---------------------------------------------------------------------------

interface RawOut {
  results: number;
  enginesInResults: Set<string>;
  unresponsive: string[];
  error?: string;
}

async function rawFetch(query: string, engines: string): Promise<RawOut> {
  const endpoint = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&engines=${engines}`;
  try {
    const resp = await fetch(endpoint, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CommunityNotesBot/1.0)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return { results: 0, enginesInResults: new Set(), unresponsive: [], error: `HTTP ${resp.status}` };
    const data = (await resp.json()) as RawResponse;
    const seen = new Set<string>();
    let resultCount = 0;
    const enginesInResults = new Set<string>();
    for (const r of data.results ?? []) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      resultCount++;
      for (const e of r.engines ?? []) enginesInResults.add(e);
    }
    const unresp: string[] = [];
    for (const u of data.unresponsive_engines ?? []) {
      if (Array.isArray(u) && typeof u[0] === "string") unresp.push(u[0]);
    }
    return { results: resultCount, enginesInResults, unresponsive: unresp };
  } catch (err: any) {
    return { results: 0, enginesInResults: new Set(), unresponsive: [], error: err?.message ?? "unknown" };
  }
}

async function getEngineSuspensions(): Promise<Map<string, number>> {
  try {
    const resp = await fetch(`${SEARXNG_URL}/stats/errors`, { signal: AbortSignal.timeout(STATS_TIMEOUT_MS) });
    if (!resp.ok) return new Map();
    const data: Record<string, SearxngStatsErr[]> = await resp.json();
    const out = new Map<string, number>();
    for (const [eng, errs] of Object.entries(data)) {
      let max = 0;
      for (const e of errs) for (const p of e.log_parameters ?? []) {
        const m = /suspended_time=(\d+)/.exec(p);
        if (m) max = Math.max(max, parseInt(m[1]!, 10));
      }
      if (max > 0) out.set(eng, max);
    }
    return out;
  } catch { return new Map(); }
}

// ---------------------------------------------------------------------------
// Family B — google-only with respectful wait
// ---------------------------------------------------------------------------

/**
 * Single rate-limited queue + wait-on-suspension. Designed to keep the
 * sustained query rate below Google's tolerance so suspensions are rare;
 * when one does happen, wait it out so the retried query returns results.
 */
export function makeGoogleOnlyStrategy(intervalMs: number) {
  const queue = new PQueue({ concurrency: 1, interval: intervalMs, intervalCap: 1 });
  let suspendedUntil = 0;
  const inflightCheck = new Map<string, Promise<void>>();

  async function checkAndMarkSuspension(engine: string): Promise<void> {
    const existing = inflightCheck.get(engine);
    if (existing) return existing;
    const p = (async () => {
      try {
        const suspensions = await getEngineSuspensions();
        const secs = suspensions.get(engine) ?? 0;
        if (secs > 0) {
          suspendedUntil = Math.max(suspendedUntil, Date.now() + secs * 1000 + SUSPENSION_BUFFER_MS);
          return;
        }
        // /stats/errors empty? Fire canary; if it also returns 0, assume default suspension.
        const canary = await rawFetch(CANARY_QUERY, engine);
        if (canary.results === 0) {
          suspendedUntil = Math.max(suspendedUntil, Date.now() + DEFAULT_SUSPENSION_S * 1000 + SUSPENSION_BUFFER_MS);
        }
      } finally { inflightCheck.delete(engine); }
    })();
    inflightCheck.set(engine, p);
    return p;
  }

  return {
    name: `B_google_only_${intervalMs}ms`,
    async fetch(query: string): Promise<FetchResult> {
      const start = Date.now();
      let waitedMs = 0;

      // Wait if we know google is suspended (shared across callers).
      while (Date.now() < suspendedUntil) {
        const waitFor = suspendedUntil - Date.now();
        waitedMs += waitFor;
        await sleep(waitFor);
      }

      let r = (await queue.add(() => rawFetch(query, "google")))!;

      if (r.results === 0) {
        await checkAndMarkSuspension("google");
        // If a suspension was set, wait and retry once.
        if (Date.now() < suspendedUntil) {
          const waitFor = suspendedUntil - Date.now();
          waitedMs += waitFor;
          await sleep(waitFor);
          r = (await queue.add(() => rawFetch(query, "google")))!;
        }
      }

      return { query, results: r.results, durationMs: Date.now() - start, engineUsed: r.results > 0 ? "google" : undefined, error: r.error, waitedForSuspensionMs: waitedMs };
    },
  };
}

// ---------------------------------------------------------------------------
// Family C — google → ddg → brave cycle
// ---------------------------------------------------------------------------

/**
 * Try engines in priority order. Each engine has its own rate-limit queue
 * and its own cool-down marker. On zero results, mark the engine and fall
 * through to the next. If all three are in cool-down, wait for the soonest
 * recovery and retry from the top of the priority list.
 *
 * The user wants Google's results when possible — so we try Google first
 * every time, and only fall to ddg/brave when Google is unavailable.
 */
export function makeCycleStrategy(opts: { intervalMs: number; priority: string[] }) {
  const queues = new Map<string, PQueue>();
  const suspendedUntil = new Map<string, number>(); // engine -> ms
  const inflightCheck = new Map<string, Promise<void>>();
  for (const e of opts.priority) {
    queues.set(e, new PQueue({ concurrency: 1, interval: opts.intervalMs, intervalCap: 1 }));
    suspendedUntil.set(e, 0);
  }

  async function checkAndMarkSuspension(engine: string): Promise<void> {
    const existing = inflightCheck.get(engine);
    if (existing) return existing;
    const p = (async () => {
      try {
        const suspensions = await getEngineSuspensions();
        const reported = suspensions.get(engine) ?? 0;
        if (reported > 0) {
          suspendedUntil.set(engine, Math.max(suspendedUntil.get(engine) ?? 0, Date.now() + reported * 1000 + SUSPENSION_BUFFER_MS));
          return;
        }
        // Canary for engines where SearXNG isn't reporting (e.g. google connect-timeouts)
        const canary = await rawFetch(CANARY_QUERY, engine);
        if (canary.results === 0) {
          // Engine is silently failing — use a short cool-down so we don't
          // stay stuck on this engine for the full default 180s when other
          // engines might recover sooner.
          suspendedUntil.set(engine, Math.max(suspendedUntil.get(engine) ?? 0, Date.now() + 60 * 1000 + SUSPENSION_BUFFER_MS));
        }
      } finally { inflightCheck.delete(engine); }
    })();
    inflightCheck.set(engine, p);
    return p;
  }

  function pickAvailable(): string | null {
    const now = Date.now();
    for (const e of opts.priority) {
      if ((suspendedUntil.get(e) ?? 0) <= now) return e;
    }
    return null;
  }

  function soonestRecoveryMs(): number {
    const now = Date.now();
    let soonest = Infinity;
    for (const e of opts.priority) {
      const until = suspendedUntil.get(e) ?? 0;
      if (until > now) soonest = Math.min(soonest, until - now);
    }
    return soonest === Infinity ? 0 : soonest;
  }

  return {
    name: `C_cycle_${opts.priority.join("+")}_${opts.intervalMs}ms`,
    async fetch(query: string): Promise<FetchResult> {
      const start = Date.now();
      let waitedMs = 0;

      // Up to 2 full passes of the priority list (after waiting for recovery).
      for (let pass = 0; pass < 2; pass++) {
        while (true) {
          const eng = pickAvailable();
          if (!eng) break;
          const q = queues.get(eng)!;
          const r = (await q.add(() => rawFetch(query, eng)))!;
          if (r.results > 0) {
            return { query, results: r.results, durationMs: Date.now() - start, engineUsed: eng, waitedForSuspensionMs: waitedMs };
          }
          await checkAndMarkSuspension(eng);
        }
        // All engines suspended — wait for soonest, then loop again.
        const waitFor = soonestRecoveryMs();
        if (waitFor <= 0) break;
        waitedMs += waitFor;
        await sleep(waitFor);
      }
      return { query, results: 0, durationMs: Date.now() - start, waitedForSuspensionMs: waitedMs };
    },
  };
}
