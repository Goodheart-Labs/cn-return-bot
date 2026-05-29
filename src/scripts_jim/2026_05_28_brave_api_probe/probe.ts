/**
 * Probe brave-api with the exact queries that returned 0 results in iter-4,
 * matching our actual fetch params byte-for-byte. Goal: confirm whether the
 * empty returns reproduce, or whether something else (rate limiting, headers,
 * encoding) is going wrong.
 */
import "dotenv/config";

const QUERIES = [
  `"dumbest group of voters" Trump People Magazine 1998`,
  `Trump said Republicans are dumbest voters quote debunked`,
  `People Magazine 1998 Trump quote fake`,
  `"ivermectin" "Parkinson's disease" clinical trial`,
  `"ivermectin" cancer treatment evidence`,
  `Brazil population by race 2022 census Afro-Brazilian`,
  `Iran teacher crying empty classroom students died`,
];

async function probe(q: string): Promise<void> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) throw new Error("BRAVE_API_KEY missing");
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`;
  const t0 = Date.now();
  const resp = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  const dt = Date.now() - t0;
  const txt = await resp.text();
  let parsed: any = null;
  try { parsed = JSON.parse(txt); } catch {}
  const results = parsed?.web?.results ?? [];
  console.log(`\n=== query: ${q}`);
  console.log(`  status=${resp.status}  dt=${dt}ms  web.results.length=${results.length}`);
  console.log(`  top-level keys: ${parsed ? Object.keys(parsed).join(", ") : "(parse failed)"}`);
  if (parsed?.web) console.log(`  web keys: ${Object.keys(parsed.web).join(", ")}`);
  if (results.length === 0) {
    // dump first 800 chars of raw body to see what came back
    console.log(`  raw body[0:800]: ${txt.slice(0, 800)}`);
  } else {
    console.log(`  first result: ${results[0].url}  (${results[0].title})`);
  }
}

(async () => {
  for (const q of QUERIES) {
    try { await probe(q); } catch (e: any) { console.error(`ERR on ${q}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 600));
  }
})();
