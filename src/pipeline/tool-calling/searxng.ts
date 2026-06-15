/**
 * Shared search client — global-queue multi-provider priority cycle.
 *
 * All search requests flow through a single global queue with a 4s gap
 * between any two searches (GLOBAL_INTERVAL_MS). SearXNG-backed engines
 * (google, brave) have an additional per-engine cooldown of 8s
 * (SEARXNG_ENGINE_COOLDOWN_MS) so they're hit at most once per 8s each,
 * naturally producing google→brave→google→brave alternation at the 4s
 * slot cadence. brave-api only obeys the global 4s gap and sits at the
 * bottom of the priority list, so it is only used as a fallback when
 * BOTH google and brave have failed (returned 0 results / been suspended)
 * for the current query — never as part of the steady-state cycle.
 *
 * Typical cadence with default providers [google, brave, brave-api]:
 *   t=0:  google (SearXNG)
 *   t=4:  brave  (SearXNG)
 *   t=8:  google (SearXNG)  — 8s since last google
 *   t=12: brave  (SearXNG)  — 8s since last brave
 *   t=16: google (SearXNG)
 *   ...
 * brave-api is picked only inside a single fetchSearxngResults call after
 * google and brave have both already returned 0 for that query (see the
 * `triedThisQuery` skip set + priority order below).
 *
 * The 4s / 8s defaults come from the binary-search probe in
 * `src/scripts_jim/2026_05_27_google_rate_limit_bsearch/FINDINGS.md`:
 * google quietly blocks past ~10 req/min, so 8s/engine (7.5 req/min)
 * sits safely below.
 *
 * On per-provider suspension, mark it and skip — do NOT wait. The cycle
 * falls to the next provider. WAIT only when EVERY provider is in
 * cool-down (rare).
 *
 * Config:
 *   SEARXNG_PROVIDERS — comma-separated priority list. Default
 *     "google,brave,brave-api".
 *   SEARCH_GLOBAL_INTERVAL_MS — minimum gap between any two searches. Default 4000.
 *   SEARXNG_ENGINE_COOLDOWN_MS — per-engine gap for SearXNG engines. Default 8000.
 *   BRAVE_API_KEY — required when "brave-api" is in the provider list.
 */

import PQueue from "p-queue";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";
const PROVIDERS = (process.env.SEARXNG_PROVIDERS ?? "google,brave,brave-api")
  .split(",").map((s) => s.trim()).filter(Boolean);
const GLOBAL_INTERVAL_MS = Number(process.env.SEARCH_GLOBAL_INTERVAL_MS) || 4_000;
const SEARXNG_ENGINE_COOLDOWN_MS = Number(process.env.SEARXNG_ENGINE_COOLDOWN_MS) || 8_000;
const DEFAULT_MAX_RESULTS = 10;
const SUSPENSION_BUFFER_MS = 5_000;
// Used when a SearXNG-backed provider reports a /stats/errors suspended_time
// but it's missing or unparseable. Matches SearXNG's typical 180s suspension.
const HTTP_BLOCK_COOLDOWN_S = 185;
// Cooldown when a provider returns 0 results for a normal-looking query —
// treat empty as "provider currently failing for our traffic" (likely captcha
// / rate-limit blocking results upstream). Shorter than HTTP_BLOCK_COOLDOWN_S
// because the provider may recover quickly; we just want to stop hammering it
// with subsequent queries that would hit the same wall.
const EMPTY_RESULT_COOLDOWN_S = 30;
// brave-api free-tier rate limit is ~1 req/sec. Honor Retry-After when given;
// fall back to this if the header is missing.
const BRAVE_API_RETRY_AFTER_DEFAULT_S = 2;
const BRAVE_API_MAX_INTRA_CALL_RETRIES = 3;
// Cap on how long a single 429 Retry-After we'll wait in-place before
// surfacing as BraveApiRateLimitError. Higher than the per-row pipeline can
// reasonably absorb (10min row budget, 3 queries → keep individual waits
// modest). 60s is generous: we'd rather sit and wait for the paid provider
// than fall through to captcha-prone scraped engines.
const BRAVE_API_MAX_RETRY_AFTER_WAIT_S = 60;
// Backoff schedule for retrying brave-api on transient failures (5xx, network
// errors, timeouts). Brave's API is the paid, high-availability path — if a
// call here fails when the API is actually up, that's our bug. Try hard before
// giving up. Total budget ~15s, well within the per-row 10-min timeout.
const BRAVE_API_TRANSIENT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];
const FETCH_TIMEOUT_MS = 15_000;
const STATS_TIMEOUT_MS = 5_000;
const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_API_PROVIDER = "brave-api";

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
  suspendedUntil: number;
  lastHitAt: number;
  inflightSuspensionCheck: Promise<void> | null;
}

const engineStates = new Map<string, EngineState>();

function getEngineState(engine: string): EngineState {
  let s = engineStates.get(engine);
  if (!s) {
    s = { suspendedUntil: 0, lastHitAt: 0, inflightSuspensionCheck: null };
    engineStates.set(engine, s);
  }
  return s;
}

// Global slot mutex: serializes provider selection so concurrent callers
// can't race on the same engine. The actual fetch runs OUTSIDE the mutex.
const slotMutex = new PQueue({ concurrency: 1 });
let nextSlotAt = 0;

function engineCooldownMs(engine: string): number {
  return engine === BRAVE_API_PROVIDER ? 0 : SEARXNG_ENGINE_COOLDOWN_MS;
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

/** Sentinel error: thrown by braveApiFetch when a 429 with Retry-After
 *  exhausted our intra-call retry budget. Carries the seconds-to-wait so the
 *  cycle can mark a precise cool-down rather than guessing. */
class BraveApiRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Brave API 429 — retry after ${retryAfterSeconds}s`);
  }
}

/** Sentinel error: brave-api returned HTTP 402 Usage Limit Exceeded — the
 *  monthly billing cap is hit, no amount of retrying helps. Cycle treats this
 *  as "brave-api is out for the rest of this run" and suspends it for a long
 *  cool-down so we don't waste request budget hammering it. */
class BraveApiQuotaExceededError extends Error {
  constructor(public detail: string) {
    super(`Brave API 402 USAGE_LIMIT_EXCEEDED — ${detail}`);
  }
}

// When brave-api reports billing-quota exceeded, suspend it for the rest of
// the run (1h is enough — the cap resets monthly so it won't recover sooner).
const BRAVE_API_QUOTA_COOLDOWN_S = 3_600;

function parseRetryAfter(header: string | null): number {
  if (!header) return BRAVE_API_RETRY_AFTER_DEFAULT_S;
  const n = parseInt(header, 10);
  if (Number.isFinite(n) && n > 0) return n;
  // Some servers send an HTTP-date instead of seconds; if so, parse it.
  const t = Date.parse(header);
  if (Number.isFinite(t)) return Math.max(1, Math.ceil((t - Date.now()) / 1000));
  return BRAVE_API_RETRY_AFTER_DEFAULT_S;
}

async function braveApiFetch(query: string): Promise<SearxngResult[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) throw new Error("BRAVE_API_KEY missing");
  const endpoint = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${DEFAULT_MAX_RESULTS}`;

  // Two independent retry budgets:
  //   - 429 (rate limit): up to BRAVE_API_MAX_INTRA_CALL_RETRIES, honoring
  //     Retry-After. If Retry-After is huge (>30s), surface as
  //     BraveApiRateLimitError so the cycle can mark brave-api suspended for
  //     that long rather than burning the per-row budget.
  //   - 5xx / network / timeout: walk BRAVE_API_TRANSIENT_BACKOFF_MS. Brave is
  //     the paid, near-always-up path; transient failures here are almost
  //     certainly recoverable, so try hard before giving up.
  // 4xx other than 429 (e.g. 400 bad query, 401 auth) is a real error — throw
  // immediately. The cycle's catch-all will suspend brave-api for 185s, which
  // is appropriate for "we're broken" but not for "Brave hiccupped."
  let rateLimitAttempts = 0;
  let transientAttempts = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { "Accept": "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      // Network error or AbortError (timeout) — treat as transient.
      if (transientAttempts >= BRAVE_API_TRANSIENT_BACKOFF_MS.length) throw err;
      await sleep(BRAVE_API_TRANSIENT_BACKOFF_MS[transientAttempts]!);
      transientAttempts++;
      continue;
    }
    if (response.status === 402) {
      // Monthly billing cap exceeded. Read the JSON body for diagnostics so
      // the suspension log makes the cause obvious. Suspend brave-api for an
      // hour — no point retrying until the user tops up / upgrades the plan.
      let detail = "Usage limit exceeded";
      try {
        const body: any = await response.json();
        detail = body?.error?.detail ?? detail;
      } catch {}
      throw new BraveApiQuotaExceededError(detail);
    }
    if (response.status === 429) {
      const wait = parseRetryAfter(response.headers.get("Retry-After"));
      // Only give up if (a) we've exhausted the in-call retry budget or
      // (b) Retry-After is pathologically large. Otherwise wait it out — the
      // paid API is more reliable than scraped fallbacks, so prefer waiting
      // over falling through.
      if (rateLimitAttempts >= BRAVE_API_MAX_INTRA_CALL_RETRIES || wait > BRAVE_API_MAX_RETRY_AFTER_WAIT_S) {
        throw new BraveApiRateLimitError(wait);
      }
      await sleep(wait * 1000);
      rateLimitAttempts++;
      continue;
    }
    if (response.status >= 500 && response.status < 600) {
      if (transientAttempts >= BRAVE_API_TRANSIENT_BACKOFF_MS.length) {
        throw new Error(`Brave API HTTP ${response.status} after ${transientAttempts} retries`);
      }
      await sleep(BRAVE_API_TRANSIENT_BACKOFF_MS[transientAttempts]!);
      transientAttempts++;
      continue;
    }
    if (!response.ok) throw new Error(`Brave API HTTP ${response.status}`);
    const data: any = await response.json();
    const seen = new Set<string>();
    const out: SearxngResult[] = [];
    for (const r of data?.web?.results ?? []) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({
        title: r.title ?? "",
        url: r.url,
        content: r.description ?? "",
        publishedDate: r.page_age ?? null,
      });
      if (out.length >= DEFAULT_MAX_RESULTS) break;
    }
    return out;
  }
}

function fetchOneProvider(query: string, provider: string): Promise<SearxngResult[]> {
  if (provider === BRAVE_API_PROVIDER) return braveApiFetch(query);
  return rawFetch(query, provider);
}

function markSuspended(provider: string, secs: number): void {
  const state = getEngineState(provider);
  const until = Date.now() + secs * 1000 + SUSPENSION_BUFFER_MS;
  if (until > state.suspendedUntil) {
    state.suspendedUntil = until;
    console.log(`[searxng] provider=${provider} suspended for ${secs}s; cycle will skip it until cool-down`);
  }
}

/** Suspend a SearXNG-backed provider after a 0-result return.
 *
 * Previously we ran a canary "is this engine healthy" probe and only marked
 * suspended if the canary also returned 0. That created a tight loop: when
 * the engine was healthy but our specific query had 0 hits (or the engine was
 * captcha-blocked but its canary happened to slip through), the cycle picked
 * the same provider again with the same query and got the same 0 results
 * forever. We now treat 0 as a definite failure signal: suspend the provider
 * for EMPTY_RESULT_COOLDOWN_S so subsequent queries skip it, *or* for the
 * engine's reported suspended_time when /stats/errors gives us one. */
async function markProviderFailedAfterEmpty(provider: string): Promise<void> {
  // brave-api is the paid, authenticated path. If it returns 0 results, that
  // almost always means "Brave's index doesn't have this exact query" (often
  // an over-quoted phrase or a non-English term), NOT that the provider is
  // failing. Don't suspend it — let the cycle try other providers for THIS
  // query, but keep brave-api fully available for the next query in the run.
  // Earlier this was the dominant cause of "blackout" rows where one quoted-
  // phrase query exhausted brave-api for the whole row.
  if (provider === BRAVE_API_PROVIDER) return;
  const state = getEngineState(provider);
  if (state.inflightSuspensionCheck) return state.inflightSuspensionCheck;
  const p = (async () => {
    try {
      const suspensions = await getEngineSuspensions();
      const reported = suspensions.get(provider) ?? 0;
      markSuspended(provider, reported > 0 ? reported : EMPTY_RESULT_COOLDOWN_S);
    } finally { state.inflightSuspensionCheck = null; }
  })();
  state.inflightSuspensionCheck = p;
  return p;
}

function pickAvailableEngine(providers: string[], skip: Set<string>): string | null {
  const now = Date.now();
  for (const e of providers) {
    if (skip.has(e)) continue;
    const state = getEngineState(e);
    if (state.suspendedUntil > now) continue;
    const cooldown = engineCooldownMs(e);
    if (cooldown > 0 && now - state.lastHitAt < cooldown) continue;
    return e;
  }
  return null;
}

function soonestRecoveryMs(providers: string[]): number {
  const now = Date.now();
  let soonest = Infinity;
  for (const e of providers) {
    const state = getEngineState(e);
    // Earliest this engine becomes available: max of suspension and cooldown
    const suspensionEnd = state.suspendedUntil;
    const cooldownEnd = state.lastHitAt + engineCooldownMs(e);
    const availableAt = Math.max(suspensionEnd, cooldownEnd);
    if (availableAt > now) soonest = Math.min(soonest, availableAt - now);
  }
  return soonest === Infinity ? 0 : soonest;
}

/** See module-level comment for the global-queue cadence. */
export class SearxngExhaustedError extends Error {
  constructor(query: string, providers: string[]) {
    super(`SearXNG exhausted: query=${JSON.stringify(query)} providers=[${providers.join(",")}]`);
    this.name = "SearxngExhaustedError";
  }
}

export async function fetchSearxngResults(
  query: string,
  opts: { engines?: string } = {},
): Promise<SearxngResult[]> {
  const providers = opts.engines
    ? opts.engines.split(",").map((s) => s.trim()).filter(Boolean)
    : PROVIDERS;

  // Cap the per-query "all providers cool-down" wait so that one query can't
  // monopolize the per-row pipeline timeout. With brave-searxng's typical 180s
  // suspension, an uncapped wait + 2 passes could burn 6+ minutes on a single
  // query; multiply by 3 queries per row and you blow the 10-min per-row
  // deadline. 30s gives slow recoveries a fair shot without holding the row
  // hostage; if nothing recovers, throw SearxngExhaustedError so the
  // orchestrator can mark this query failed and move on.
  const MAX_COOL_DOWN_WAIT_MS = 30_000;

  const triedThisQuery = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    while (true) {
      // Claim a global slot: serialized so concurrent callers can't race on
      // the same engine. The slot enforces GLOBAL_INTERVAL_MS between starts.
      const claimed = await slotMutex.add(async () => {
        const waitMs = nextSlotAt - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        const provider = pickAvailableEngine(providers, triedThisQuery);
        if (!provider) return null;
        getEngineState(provider).lastHitAt = Date.now();
        nextSlotAt = Date.now() + GLOBAL_INTERVAL_MS;
        return provider;
      });
      if (!claimed) break;
      let results: SearxngResult[];
      try {
        results = await fetchOneProvider(query, claimed);
      } catch (err) {
        if (err instanceof BraveApiRateLimitError) {
          markSuspended(claimed, err.retryAfterSeconds);
        } else if (err instanceof BraveApiQuotaExceededError) {
          console.log(`[searxng] brave-api over monthly billing cap: ${err.detail}`);
          markSuspended(claimed, BRAVE_API_QUOTA_COOLDOWN_S);
        } else {
          markSuspended(claimed, HTTP_BLOCK_COOLDOWN_S);
        }
        results = [];
      }
      if (results.length > 0) return results;
      triedThisQuery.add(claimed);
      await markProviderFailedAfterEmpty(claimed);
    }
    const waitMs = soonestRecoveryMs(providers);
    if (waitMs <= 0) break;
    const cappedWait = Math.min(waitMs, MAX_COOL_DOWN_WAIT_MS);
    console.log(`[searxng] all providers in cool-down; waiting ${(cappedWait / 1000).toFixed(0)}s (uncapped would be ${(waitMs / 1000).toFixed(0)}s)`);
    await sleep(cappedWait);
  }
  throw new SearxngExhaustedError(query, providers);
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
