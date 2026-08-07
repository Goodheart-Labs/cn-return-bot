/**
 * Substack feed proxy. This is a Cloudflare Worker that relays RSS fetches for
 * the everything pipeline.
 *
 * Substack refuses GitHub Actions' datacenter IPs outright with a 403. It also
 * rate-limits the shared egress IPs that Cloudflare Workers go out through. The
 * success rate of a live fetch swings between roughly 100% and roughly 10%
 * depending on how congested those shared IPs are. So this worker does more
 * than relay. A cron trigger keeps a copy of every requested feed fresh in KV
 * storage in the background, and a request is answered from that copy straight
 * away. A feed that is a few minutes out of date does not matter at our
 * cadence. Authors post about once a day and the pipeline polls every 30
 * minutes. The client throws when the cached copy is more than a day old, so a
 * worker that is blocked completely fails loudly instead of quietly serving
 * frozen data.
 *
 * GET <worker-url>?url=https://<pub>.substack.com/feed
 * with header X-Proxy-Key: <PROXY_KEY secret>
 *
 * Only exact /feed URLs are relayed, and only when the request carries the
 * shared key. That stops this from being usable as an open proxy. Once a feed
 * has been requested it is refreshed automatically, until nobody has asked for
 * it for a week. See README.md for how to deploy it.
 */

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>;
}

interface Env {
  PROXY_KEY: string;
  FEEDS: KVNamespace;
}

const ALLOWED_TARGET = /^https:\/\/[\w-]+\.substack\.com\/feed$/;
const LIVE_RETRIES = 3;
const RETRY_GAP_MS = 2000;
/** The cron refreshes a cached feed once it is older than this. The cron itself
 *  runs every 5 minutes. */
const REFRESH_AGE_MS = 4 * 60_000;
/** Stop refreshing a feed nobody has requested for this long. */
const WANTED_TTL_MS = 7 * 24 * 3600_000;

interface CachedFeed {
  fetchedAt: number;
  xml: string;
}

async function fetchFeedLive(url: string, retries: number): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.ok) return res.text();
    await new Promise((r) => setTimeout(r, RETRY_GAP_MS));
  }
  return null;
}

async function cacheFeed(env: Env, url: string, xml: string): Promise<void> {
  await env.FEEDS.put(`feed:${url}`, JSON.stringify({ fetchedAt: Date.now(), xml } satisfies CachedFeed));
}

function feedResponse(xml: string, ageMs: number): Response {
  return new Response(xml, {
    headers: { "Content-Type": "text/xml", "X-Cache-Age-Seconds": String(Math.round(ageMs / 1000)) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("X-Proxy-Key") !== env.PROXY_KEY) {
      return new Response("forbidden", { status: 403 });
    }
    const target = new URL(request.url).searchParams.get("url") ?? "";
    if (!ALLOWED_TARGET.test(target)) {
      return new Response("url not allowed", { status: 400 });
    }

    // Register interest so the cron keeps this feed fresh from now on.
    await env.FEEDS.put(`wanted:${target}`, String(Date.now()));

    const cached = await env.FEEDS.get(`feed:${target}`);
    if (cached) {
      const { fetchedAt, xml } = JSON.parse(cached) as CachedFeed;
      return feedResponse(xml, Date.now() - fetchedAt);
    }
    // This is the first request we have ever seen for this feed, so nothing is
    // cached yet. We try a live fetch. Either way the cron warms the cache
    // within minutes.
    const live = await fetchFeedLive(target, LIVE_RETRIES);
    if (live) {
      await cacheFeed(env, target, live);
      return feedResponse(live, 0);
    }
    return new Response("feed not cached yet and live fetch rate-limited — retry in a few minutes", { status: 503 });
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    const { keys } = await env.FEEDS.list({ prefix: "wanted:" });
    for (const key of keys) {
      const url = key.name.slice("wanted:".length);
      const wantedAt = Number(await env.FEEDS.get(key.name));
      if (Date.now() - wantedAt > WANTED_TTL_MS) continue;
      const cached = await env.FEEDS.get(`feed:${url}`);
      if (cached && Date.now() - (JSON.parse(cached) as CachedFeed).fetchedAt < REFRESH_AGE_MS) continue;
      const live = await fetchFeedLive(url, LIVE_RETRIES);
      if (live) await cacheFeed(env, url, live);
    }
  },
};
