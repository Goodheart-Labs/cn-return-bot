/**
 * Shared SearXNG client with state-aware retry on engine suspensions.
 *
 * Background: SearXNG's `google` (and other) engines transparently get blocked
 * by upstream — Google issues 403 / CAPTCHA when query rate is too high.
 * SearXNG catches that and suspends the engine for `suspended_time` seconds
 * (default 180s on HTTP 429/403, 3600s on CAPTCHA, 604800s on reCAPTCHA).
 * While suspended the engine returns zero results, which is indistinguishable
 * from "the query genuinely has no hits" unless the caller knows.
 *
 * This module makes that state observable:
 *   1. Every search hits `GET /search?engines=…`.
 *   2. If zero results came back, we ask `GET /stats/errors?format=json` and
 *      parse any `suspended_time=N` in the engine's recent errors.
 *   3. Per-engine "suspended until" is stored in a process-wide map so every
 *      caller (cheap-bot, simple-bot's tool-loop, future bots) shares the
 *      knowledge and waits exactly that long before retrying.
 *   4. Subsequent calls check the map BEFORE issuing the query, so a bot
 *      doesn't fire 50 doomed queries while the engine is cooling down.
 *
 * One retry per query — if the post-wait retry still returns zero, treat it
 * as a real no-hits result. The caller (cheap-bot orchestrator) has its own
 * no-findings guard for that case.
 */

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_ENGINES = "google";
const SUSPENSION_BUFFER_MS = 5_000; // slop on top of the engine's suspended_time
// Default suspension when we detect a block but SearXNG hasn't reported a
// specific suspended_time (e.g. /stats/errors hasn't aggregated yet). 180s
// matches SearXNG's default for HTTP 429/403 from upstream search engines.
const DEFAULT_SUSPENSION_SECONDS = 180;
// Canary query — short, generic, guaranteed-to-match. If a regular query
// returns 0 results we fire this; if the canary ALSO returns 0, the engine
// is suspended (not the original query being genuinely empty).
const CANARY_QUERY = "wikipedia";

// Per-engine, when can we resume hitting it (ms since epoch). Shared across
// every caller in the process — when one query triggers a suspension every
// other in-flight bot sees and respects it.
const engineSuspendedUntil = new Map<string, number>();

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

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

function parseSuspendedTimeSeconds(errs: SearxngStatsError[]): number {
  // Pick the largest suspended_time across recent errors for this engine.
  // Mixed exception classes (429 / CAPTCHA / AccessDenied) all carry the
  // same `suspended_time=N` pattern in log_parameters.
  let maxSecs = 0;
  for (const e of errs) {
    for (const p of e.log_parameters ?? []) {
      const m = /suspended_time=(\d+)/.exec(p);
      if (m) maxSecs = Math.max(maxSecs, parseInt(m[1]!, 10));
    }
  }
  return maxSecs;
}

async function getEngineSuspensions(): Promise<Map<string, number>> {
  // Returns a per-engine "suspended_time in seconds" map from SearXNG's
  // /stats/errors endpoint. Engines not currently in trouble are absent.
  // Note: this endpoint is only populated after SearXNG has aggregated
  // errors — empirically it's reliable for sustained / repeated suspensions
  // but can be empty during a fresh burst. Treat as one signal among several.
  try {
    const resp = await fetch(`${SEARXNG_URL}/stats/errors`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return new Map();
    const data: Record<string, SearxngStatsError[]> = await resp.json();
    const out = new Map<string, number>();
    for (const [engine, errs] of Object.entries(data)) {
      const secs = parseSuspendedTimeSeconds(errs);
      if (secs > 0) out.set(engine, secs);
    }
    return out;
  } catch {
    return new Map();
  }
}

async function canaryProbeReturnsZero(engines: string): Promise<boolean> {
  // Returns true iff a known-good generic query also yields zero — strong
  // signal the engine is suspended rather than the original query being a
  // genuine miss. False on errors so we don't over-classify.
  try {
    const results = await rawFetch(CANARY_QUERY, engines);
    return results.length === 0;
  } catch {
    return false;
  }
}

async function waitForEngines(engines: string[]): Promise<void> {
  // Block until every engine we care about has come out of suspension.
  // Engines we've never seen suspended (not in the map) are skipped.
  const now = Date.now();
  let maxWait = 0;
  for (const eng of engines) {
    const until = engineSuspendedUntil.get(eng);
    if (until && until > now) maxWait = Math.max(maxWait, until - now);
  }
  if (maxWait > 0) {
    // Visible signal — without this, sustained pipeline runs look mysteriously
    // slow. Cap the log to once per ~5s to avoid flooding parallel workers.
    console.log(`[searxng] waiting ${(maxWait / 1000).toFixed(1)}s for ${engines.join(",")} suspension to lift`);
    await sleep(maxWait);
  }
}

async function rawFetch(query: string, engines: string): Promise<SearxngResult[]> {
  const endpoint = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&engines=${engines}`;
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CommunityNotesBot/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
  const data: RawSearchResponse = await response.json();
  // De-dupe by URL (multi-engine fan-out may return the same URL from
  // several backends) and cap at the result limit. Order preserved — first
  // hit wins, which approximates the SearXNG-side rank.
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

/**
 * Suspension-aware SearXNG fetch. Other modules should call this instead of
 * hitting SearXNG directly so they share the engine-state map.
 *
 * Behavior:
 *   1. Wait if any requested engine is currently suspended.
 *   2. Fire the query.
 *   3. On zero results, look up the engine's suspension state via
 *      /stats/errors. If suspended, record the resume time in the shared
 *      map, wait that long, retry once.
 *   4. Return whatever the second attempt produced.
 */
export async function fetchSearxngResults(
  query: string,
  opts: { engines?: string } = {},
): Promise<SearxngResult[]> {
  const engines = opts.engines ?? DEFAULT_ENGINES;
  const engineList = engines.split(",").map((s) => s.trim()).filter(Boolean);

  await waitForEngines(engineList);
  let results = await rawFetch(query, engines);

  if (results.length === 0) {
    // Two-stage detection. /stats/errors is the precise source (it carries
    // the actual suspended_time), but it can be empty during a fresh burst.
    // A canary query catches that case — if "wikipedia" also returns nothing,
    // the engine is definitely suspended and we fall back to the 180s default.
    const suspensions = await getEngineSuspensions();
    let detected = false;
    for (const eng of engineList) {
      const reported = suspensions.get(eng);
      if (reported && reported > 0) {
        markSuspended(eng, reported);
        detected = true;
      }
    }
    if (!detected && (await canaryProbeReturnsZero(engines))) {
      for (const eng of engineList) markSuspended(eng, DEFAULT_SUSPENSION_SECONDS);
      detected = true;
    }
    if (detected) {
      await waitForEngines(engineList);
      results = await rawFetch(query, engines);
    }
  }

  return results;
}

function markSuspended(engine: string, secs: number): void {
  const until = Date.now() + secs * 1000 + SUSPENSION_BUFFER_MS;
  const prev = engineSuspendedUntil.get(engine) ?? 0;
  if (until > prev) {
    engineSuspendedUntil.set(engine, until);
    console.log(`[searxng] engine=${engine} suspended; will retry in ${secs}s`);
  }
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

