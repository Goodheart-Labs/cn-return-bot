/* Asks the Substack relay for each feed the walk reads and prints how old its
 * cached copy is and the newest post in it. Runs only in CI, which holds the
 * relay's key. Every feed listed here is one the walk already requests, so the
 * probe adds no feed to the relay's refresh list. */
const FEEDS = ["thezvi", "astralcodexten", "andymasley", "benthams", "randombytes", "verysane", "freddiedeboer", "slowboring", "noahpinion", "thezvi"];
for (const pub of new Set(FEEDS)) {
  const target = `https://${pub}.substack.com/feed`;
  const res = await fetch(`${process.env.SUBSTACK_PROXY_URL}?url=${encodeURIComponent(target)}`, { headers: { "X-Proxy-Key": process.env.SUBSTACK_PROXY_KEY ?? "" } });
  const xml = await res.text();
  const age = Number(res.headers.get("X-Cache-Age-Seconds") ?? NaN);
  const newest = xml.match(/<item>[\s\S]*?<pubDate>([^<]*)<\/pubDate>/)?.[1];
  console.log(`${pub.padEnd(16)} ${res.status} cache age ${(age / 3600).toFixed(2)}h  newest post ${newest}`);
}
