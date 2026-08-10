/**
 * The shared search client. It cycles through several providers in priority
 * order and puts every request through one global queue.
 *
 * That global queue leaves a gap of 4 seconds between any two searches
 * (GLOBAL_INTERVAL_MS). The engines we reach through SearXNG, google and brave,
 * have a further per-engine cooldown of 8 seconds (SEARXNG_ENGINE_COOLDOWN_MS).
 * Each of them is therefore hit at most once every 8 seconds. The two rules
 * together make the cycle alternate between google and brave on the 4-second
 * slots. brave-api obeys only the global 4-second gap and sits at the bottom of
 * the priority list. It is used only as a fallback, once both google and brave
 * have failed for the current query by returning no results or by being
 * suspended. It is never part of the steady-state cycle.
 *
 * A typical cadence with the default providers [google, brave, brave-api]:
 *   t=0:  google (SearXNG)
 *   t=4:  brave  (SearXNG)
 *   t=8:  google (SearXNG), 8s after the last google
 *   t=12: brave  (SearXNG), 8s after the last brave
 *   t=16: google (SearXNG)
 *   ...
 * brave-api is only picked inside a single fetchSearxngResults call, after
 * google and brave have both already returned no results for that query. The
 * `triedThisQuery` skip set and the priority order below are what implement
 * this.
 *
 * The defaults of 4 and 8 seconds come from the binary-search probe in
 * `src/scripts_jim/2026_05_27_google_rate_limit_bsearch/FINDINGS.md`. Google
 * quietly blocks us past roughly 10 requests per minute. Eight seconds per
 * engine is 7.5 requests per minute, which sits safely below that.
 *
 * When a single provider is suspended we mark it and skip it. We never wait for
 * it. The cycle simply moves on to the next provider. We only wait when every
 * provider is in cool-down, which is rare.
 *
 * Configuration:
 *   SEARXNG_PROVIDERS is the comma-separated priority list. It defaults to
 *     "google,brave,brave-api".
 *   SEARCH_GLOBAL_INTERVAL_MS is the smallest gap between any two searches, in
 *     milliseconds. It defaults to 4000.
 *   SEARXNG_ENGINE_COOLDOWN_MS is the per-engine gap for the SearXNG engines, in
 *     milliseconds. It defaults to 8000.
 *   BRAVE_API_KEY is required when "brave-api" is in the provider list.
 */

import PQueue from "p-queue";

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";
const PROVIDERS = (process.env.SEARXNG_PROVIDERS ?? "google,brave,brave-api")
  .split(",").map((s) => s.trim()).filter(Boolean);
const GLOBAL_INTERVAL_MS = Number(process.env.SEARCH_GLOBAL_INTERVAL_MS) || 4_000;
const SEARXNG_ENGINE_COOLDOWN_MS = Number(process.env.SEARXNG_ENGINE_COOLDOWN_MS) || 8_000;
const DEFAULT_MAX_RESULTS = 10;
const SUSPENSION_BUFFER_MS = 5_000;
// How long we suspend a provider whose search request threw, for example on an
// HTTP error or a block. We do not know how long such a block lasts, so we use
// SearXNG's usual suspension of 180 seconds with a little margin on top.
const HTTP_BLOCK_COOLDOWN_S = 185;
// How long we suspend a provider that returned no results for a query that looks
// normal. We read an empty answer as the provider currently failing for our
// traffic. A captcha or a rate limit upstream is the likely cause. This is
// shorter than HTTP_BLOCK_COOLDOWN_S because the provider may recover quickly.
// All we want is to stop hammering it with later queries that would hit the same
// wall.
const EMPTY_RESULT_COOLDOWN_S = 30;
// The free tier of brave-api allows roughly one request per second. We honour a
// Retry-After header whenever the response carries one. This value is the
// fallback for when the header is missing.
const BRAVE_API_RETRY_AFTER_DEFAULT_S = 2;
const BRAVE_API_MAX_INTRA_CALL_RETRIES = 3;
// The longest Retry-After we wait out in place after a 429. Anything longer is
// surfaced as a BraveApiRateLimitError instead. A row has a budget of 10 minutes
// and runs about three queries, so a single wait has to stay modest. 60 seconds
// is generous on purpose. We would rather sit and wait for the paid provider than
// fall through to the scraped engines, which often hit a captcha.
const BRAVE_API_MAX_RETRY_AFTER_WAIT_S = 60;
// The backoff schedule for retrying brave-api after a transient failure. Those
// are 5xx responses, network errors and timeouts. Brave's API is the paid path
// and is almost always up. If a call fails here while the API is healthy, the
// fault is most likely ours, so we try hard before giving up. The whole schedule
// adds up to about 15 seconds, which fits comfortably inside the 10-minute row
// timeout.
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

// A global mutex around the slot claim. It serializes provider selection so that
// concurrent callers cannot race on the same engine. The fetch itself runs
// outside the mutex.
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

/** Thrown by braveApiFetch when a 429 response used up the retry budget we allow
 *  inside a single call. It carries the number of seconds to wait, so the cycle
 *  can set an exact cool-down instead of guessing one. */
class BraveApiRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Brave API 429 — retry after ${retryAfterSeconds}s`);
  }
}

/** Thrown when brave-api answers with HTTP 402 Usage Limit Exceeded. The monthly
 *  billing cap has been reached and no amount of retrying helps. The cycle treats
 *  brave-api as gone for the rest of the run and suspends it for a long
 *  cool-down, so we do not waste requests on it. */
class BraveApiQuotaExceededError extends Error {
  constructor(public detail: string) {
    super(`Brave API 402 USAGE_LIMIT_EXCEEDED — ${detail}`);
  }
}

// How long we suspend brave-api once it reports that the billing quota is
// exceeded. An hour effectively means the rest of the run. The cap only resets
// monthly, so the provider cannot recover any sooner anyway.
const BRAVE_API_QUOTA_COOLDOWN_S = 3_600;

function parseRetryAfter(header: string | null): number {
  if (!header) return BRAVE_API_RETRY_AFTER_DEFAULT_S;
  const n = parseInt(header, 10);
  if (Number.isFinite(n) && n > 0) return n;
  // Some servers send an HTTP date instead of a number of seconds. We parse that
  // form too.
  const t = Date.parse(header);
  if (Number.isFinite(t)) return Math.max(1, Math.ceil((t - Date.now()) / 1000));
  return BRAVE_API_RETRY_AFTER_DEFAULT_S;
}

async function braveApiFetch(query: string): Promise<SearxngResult[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) throw new Error("BRAVE_API_KEY missing");
  const endpoint = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${DEFAULT_MAX_RESULTS}`;

  // There are two independent retry budgets here.
  // A 429 means we are rate limited. We retry up to
  // BRAVE_API_MAX_INTRA_CALL_RETRIES times and honour the Retry-After header. If
  // Retry-After asks for more than BRAVE_API_MAX_RETRY_AFTER_WAIT_S, we throw a
  // BraveApiRateLimitError instead. The cycle can then suspend brave-api for
  // exactly that long, rather than burning the row's budget waiting in here.
  // A 5xx response, a network error or a timeout is transient. For those we walk
  // BRAVE_API_TRANSIENT_BACKOFF_MS. Brave is the paid path and is almost always
  // up, so such a failure is nearly always recoverable and worth trying hard for.
  // Any other 4xx, for example a 400 for a bad query or a 401 for bad auth, is a
  // real error and we throw at once. The cycle's catch-all then suspends
  // brave-api for 185 seconds. That is the right response to "we are broken" and
  // the wrong one to "Brave hiccupped".
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
      // This is a network error, or an AbortError from the timeout. We treat
      // both as transient.
      if (transientAttempts >= BRAVE_API_TRANSIENT_BACKOFF_MS.length) throw err;
      await sleep(BRAVE_API_TRANSIENT_BACKOFF_MS[transientAttempts]!);
      transientAttempts++;
      continue;
    }
    if (response.status === 402) {
      // The monthly billing cap is exceeded. We read the detail message out of
      // the JSON body so the suspension log makes the cause obvious. brave-api
      // is then suspended for an hour. Retrying is pointless until someone tops
      // up the account or upgrades the plan.
      let detail = "Usage limit exceeded";
      try {
        const body: any = await response.json();
        detail = body?.error?.detail ?? detail;
      } catch {}
      throw new BraveApiQuotaExceededError(detail);
    }
    if (response.status === 429) {
      const wait = parseRetryAfter(response.headers.get("Retry-After"));
      // We give up here for one of two reasons only. Either the retry budget for
      // this call is used up, or Retry-After asks for an unreasonably long wait.
      // Otherwise we wait it out. The paid API is more reliable than the scraped
      // fallbacks, so waiting beats falling through to them.
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

/** Suspends a SearXNG-backed provider after it returned no results.
 *
 * We used to run a canary query first to ask whether the engine was healthy, and
 * only suspended the provider when that canary also came back empty. It created a
 * tight loop. The engine could be healthy while our own query genuinely had no
 * hits. The engine could also be blocked by a captcha while its canary slipped
 * through. In both cases the cycle picked the same provider again with the same
 * query and got no results again, forever. We now treat an empty answer as a
 * definite failure signal. The provider is suspended for EMPTY_RESULT_COOLDOWN_S
 * so that later queries skip it. When /stats/errors reports a suspended_time for
 * the engine, we use that duration instead. */
async function markProviderFailedAfterEmpty(provider: string): Promise<void> {
  // brave-api is the paid, authenticated path. When it returns no results, that
  // almost always means Brave's index has nothing for this exact query. An
  // over-quoted phrase or a term in another language are the usual causes. It
  // does not mean the provider is failing. So we do not suspend it. The cycle
  // still tries the other providers for this query, and brave-api stays fully
  // available for the next query in the run. Suspending it here used to be the
  // main cause of blackout rows, where a single quoted-phrase query used up
  // brave-api for the whole row.
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
    // The engine becomes available again at the later of the two: the end of its
    // suspension and the end of its cooldown.
    const suspensionEnd = state.suspendedUntil;
    const cooldownEnd = state.lastHitAt + engineCooldownMs(e);
    const availableAt = Math.max(suspensionEnd, cooldownEnd);
    if (availableAt > now) soonest = Math.min(soonest, availableAt - now);
  }
  return soonest === Infinity ? 0 : soonest;
}

/** Thrown when no provider produced results for a query and none is going to
 *  recover in time. The module comment at the top of this file describes the
 *  cycle that ends here. */
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

  // This caps how long one query waits for the providers to come out of
  // cool-down, so that a single query cannot monopolize the pipeline timeout of
  // its row. The brave engine on SearXNG typically suspends for 180 seconds.
  // Without a cap, two passes could burn more than 6 minutes on one query. A row
  // runs about three queries, so that would blow its 10-minute deadline. Waiting
  // 30 seconds gives a slow recovery a fair chance without holding the row
  // hostage. If nothing recovers we throw SearxngExhaustedError, and the
  // orchestrator marks this query failed and moves on.
  const MAX_COOL_DOWN_WAIT_MS = 30_000;

  const triedThisQuery = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    while (true) {
      // Claim a global slot. The claim is serialized so that concurrent callers
      // cannot race on the same engine. A slot also enforces GLOBAL_INTERVAL_MS
      // between two search starts.
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
