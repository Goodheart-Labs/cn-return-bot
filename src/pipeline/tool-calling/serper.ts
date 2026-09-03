/**
 * The shared search client, backed by the Serper API (google.serper.dev).
 *
 * Serper replaced the old SearXNG setup in September 2026. That setup cycled
 * two scraped engines and the capped Brave API behind a global queue,
 * per-engine cooldowns, and suspension tracking, because scraping gets rate
 * limited and Brave's monthly quota kept running out. When the quota died the
 * prefilter went blind and rejected the whole feed (see GOO-51). Serper is a
 * paid API with rate limits far above our volume, so none of that machinery is
 * needed: one request per search, with a short retry schedule for transient
 * failures.
 *
 * SERPER_API_KEY must be set. The account is billed per search.
 */

const SERPER_URL = "https://google.serper.dev/search";
const DEFAULT_MAX_RESULTS = 10;
const FETCH_TIMEOUT_MS = 15_000;
// The backoff schedule for transient failures: 429, 5xx, network errors and
// timeouts. Serper is almost always up, so a failure here is worth retrying
// hard for. The whole schedule adds up to about 15 seconds, which fits
// comfortably inside the 10-minute row timeout.
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate: string | null;
}

/** Thrown when Serper stayed unreachable through the whole retry schedule. The
 *  orchestrator treats the query as failed and moves on. */
export class SearchUnavailableError extends Error {
  constructor(query: string, cause: string) {
    super(`serper_unavailable: query=${JSON.stringify(query)} cause=${cause}`);
    this.name = "SearchUnavailableError";
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

export async function fetchSearchResults(query: string): Promise<SearchResult[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY missing");

  let lastFailure = "";
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS[attempt - 1]!);
    let response: Response;
    try {
      response = await fetch(SERPER_URL, {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: DEFAULT_MAX_RESULTS }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      // A network error, or an AbortError from the timeout. Both are transient.
      lastFailure = (err as Error)?.message ?? "network error";
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      lastFailure = `HTTP ${response.status}`;
      continue;
    }
    // Any other non-ok status is a real error: bad auth, a bad request, or an
    // exhausted credit balance. Retrying cannot fix those, so we fail fast and
    // let the error surface.
    if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);

    const data: { organic?: SerperOrganicResult[] } = await response.json();
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const r of data.organic ?? []) {
      if (!r.link || seen.has(r.link)) continue;
      seen.add(r.link);
      out.push({
        title: r.title ?? "",
        url: r.link,
        content: r.snippet ?? "",
        publishedDate: r.date ?? null,
      });
      if (out.length >= DEFAULT_MAX_RESULTS) break;
    }
    return out;
  }
  throw new SearchUnavailableError(query, lastFailure);
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results.";
  return results
    .map((r, i) => {
      const dateLine = r.publishedDate ? `\n   Published: ${r.publishedDate}` : "";
      return `${i + 1}. ${r.title}${dateLine}\n   ${r.url}\n   ${r.content}`;
    })
    .join("\n\n");
}
