/**
 * The residential proxy, and the only code that reads its address.
 *
 * Some sites refuse requests from datacenter machines, which is what GitHub's
 * runners and our services machine are. YouTube answers "Sign in to confirm
 * you're not a bot", and Substack's API answers 403. Requests to those sites go
 * through a residential proxy instead (DataImpulse, paid per gigabyte). It
 * forwards each connection through a real person's device, such as a phone or
 * a home router, and picks a different device for every connection.
 *
 * Those devices are also why the proxy is unreliable. They go offline, change
 * networks, or are slow, so some connections hang or get cut off. Measured
 * from the services machine on 2026-09-18, about one connection in thirteen
 * failed, whatever the destination, while direct connections never did. A
 * second try usually lands on a different device and works. So every proxied
 * request goes through withResidentialProxy, which retries on a fresh
 * connection.
 */

/** How often a proxied request is tried before its last error is thrown.
 *  With about one connection in thirteen failing, three tries fail together
 *  roughly once in two thousand requests. */
const PROXY_ATTEMPTS = 3;

/** How long one proxied fetch may take. A healthy one through the proxy takes
 *  one to eight seconds. One still waiting after this is stuck on a dead
 *  device, and a fresh connection helps more than waiting longer. */
const PROXY_FETCH_TIMEOUT_MS = 30_000;

/** How much of an error goes into a retry log line. */
const MAX_REASON_LENGTH = 200;

/** The proxy's address, or undefined when none is configured, as on a local
 *  machine. The variable keeps its old name, because the GitHub secret and the
 *  services machine's env file both use it. */
function residentialProxyUrl(): string | undefined {
  return process.env.YTDLP_PROXY_URL?.trim() || undefined;
}

/** The text with the proxy's address replaced by a placeholder. The address
 *  carries the account's username and password, and a failed yt-dlp command
 *  prints its whole command line, proxy included, into the error. Anything
 *  that may end up in a log or a database row goes through this first. */
export function hideProxyAddress(text: string): string {
  const proxyUrl = residentialProxyUrl();
  return proxyUrl ? text.replaceAll(proxyUrl, "<residential proxy>") : text;
}

/**
 * Runs `attempt` through the residential proxy, and runs it again on a fresh
 * connection when it fails in a way a different device could fix.
 *
 * `attempt` receives the proxy's address and must use it for its connection.
 * `isRetryable` decides which errors are worth another try. By default every
 * error is. After the last try, its error is thrown unchanged.
 *
 * When no proxy is configured, `attempt` runs once with `undefined` and
 * connects directly.
 */
export async function withResidentialProxy<T>(
  target: string,
  attempt: (proxyUrl: string | undefined) => Promise<T>,
  isRetryable: (err: unknown) => boolean = () => true,
): Promise<T> {
  const proxyUrl = residentialProxyUrl();
  const attempts = proxyUrl ? PROXY_ATTEMPTS : 1;
  for (let n = 1; ; n++) {
    try {
      return await attempt(proxyUrl);
    } catch (err) {
      if (n >= attempts || !isRetryable(err)) throw err;
      const reason = hideProxyAddress(err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON_LENGTH);
      console.warn(`[proxy] attempt ${n}/${attempts} failed for ${target} (${reason}), retrying on a fresh connection`);
    }
  }
}

/** A site answered with an error status. */
class HttpStatusError extends Error {
  constructor(readonly status: number, url: string, statusText: string) {
    super(`${status} ${statusText} for ${url}`);
  }
}

/** Statuses a different device might not get: the site refused this device's
 *  address (403), rate-limited it (429), or something between the proxy and
 *  the site failed (5xx). Any other error status is the site's real answer. */
function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

/** GETs a URL through the residential proxy and parses the answer as JSON.
 *  The body is read inside the retry, so a connection that drops halfway
 *  through the answer is retried too. */
export async function fetchJsonViaResidentialProxy(url: string): Promise<any> {
  return withResidentialProxy(
    url,
    async (proxy) => {
      const res = await fetch(url, { proxy, signal: AbortSignal.timeout(PROXY_FETCH_TIMEOUT_MS) } as RequestInit);
      if (!res.ok) throw new HttpStatusError(res.status, url, res.statusText);
      return res.json();
    },
    (err) => !(err instanceof HttpStatusError) || isRetryableStatus(err.status),
  );
}
