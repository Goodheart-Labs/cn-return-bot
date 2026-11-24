/* Retry with exponential backoff. When a read fails in a way that often goes
 * away by itself, we wait a moment and try again. Each wait is twice as long as
 * the one before, so a struggling server is not flooded with retries. Each wait
 * also gets a random extra part, called jitter, so that many readers who hit
 * the same outage do not all retry at the same instant. */

/** How many times a failed request is tried again before its failure counts. */
const MAX_RETRIES = 3;
/** The wait before the first retry. The later waits double: 1 s, 2 s, 4 s. */
const FIRST_RETRY_DELAY_MS = 1_000;
/** Each wait grows by a random share of itself, up to this fraction. */
const MAX_JITTER_FRACTION = 0.5;

const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const FIRST_SERVER_ERROR_STATUS = 500;

/** The HTTP methods that only read. Sending such a request twice has the same
 *  effect as sending it once, so a retry can never write anything twice. */
const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);

/** The wait before retry number `retry`, counted from 0. */
export function backoffDelayMs(retry: number): number {
  const exponential = FIRST_RETRY_DELAY_MS * 2 ** retry;
  return exponential * (1 + Math.random() * MAX_JITTER_FRACTION);
}

/** Whether an HTTP status says the server may well answer the same request
 *  a moment later. That is every server error (500 and up), a server that
 *  asks us to slow down (429), and a server that gave up waiting for us (408).
 *  Every other 4xx status means the request itself is wrong or not allowed,
 *  and it would fail the same way every time. */
export function isTransientStatus(status: number): boolean {
  return status >= FIRST_SERVER_ERROR_STATUS || status === HTTP_TOO_MANY_REQUESTS || status === HTTP_REQUEST_TIMEOUT;
}

/** fetch rejects with a TypeError when no answer arrived at all, for example
 *  after a network blip. We compare the name rather than use instanceof,
 *  because a Firefox content script sees errors from another JavaScript realm,
 *  whose TypeError is a different class. An abort rejects with an AbortError.
 *  The caller cancelled on purpose, so an abort is never retried. */
const isNetworkError = (error: unknown) => (error as Error | null)?.name === "TypeError";

const methodOf = (input: RequestInfo | URL, init?: RequestInit) =>
  (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

/** A drop-in fetch that retries read-only requests with exponential backoff
 *  when the network failed or the server answered with a transient status. A
 *  request that writes goes out exactly once, because a retry after a lost
 *  answer could write twice. When the retries run out, the caller gets the
 *  last answer or error unchanged, so the failure stays visible. */
export async function fetchWithRetries(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!READ_ONLY_METHODS.has(methodOf(input, init))) return fetch(input, init);
  for (let retry = 0; ; retry++) {
    const lastTry = retry === MAX_RETRIES;
    try {
      const response = await fetch(input, init);
      if (lastTry || !isTransientStatus(response.status)) return response;
      void response.body?.cancel();
    } catch (error) {
      if (lastTry || !isNetworkError(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(retry)));
  }
}
