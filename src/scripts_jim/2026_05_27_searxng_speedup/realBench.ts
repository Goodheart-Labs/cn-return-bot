/**
 * Real-SearXNG validation — hits the live container.
 *
 * Run a single tweet-worth (3 queries) through each strategy, log hits and
 * engine used. Designed to be fast (<60s total) so we can sanity-check the
 * strategy code against actual SearXNG before committing to a longer run.
 *
 *   bun run src/scripts_jim/2026_05_27_searxng_speedup/realBench.ts
 */

import { makeGoogleOnlyStrategy, makeCycleStrategy } from "./strategies";

async function runStrategy(s: { name: string; fetch: (q: string) => Promise<any> }) {
  const queries = ["tesla model y review", "biden inflation 2024", "openai gpt5 release"];
  console.log(`\n----- ${s.name} -----`);
  const start = Date.now();
  for (const q of queries) {
    const r = await s.fetch(q);
    console.log(`  q="${q}" → results=${r.results} engine=${r.engineUsed ?? "—"} waited=${(r.waitedForSuspensionMs / 1000).toFixed(1)}s dur=${(r.durationMs / 1000).toFixed(2)}s`);
  }
  console.log(`  total wall: ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function main() {
  // Google-only against current live state would do 3× 185s waits = 9 min of
  // pure waiting (Google is hard-429 right now). The mock bench already
  // covers that strategy at scale. Here we just want to prove the cycle
  // strategy ACTUALLY produces real results when at least one fallback is
  // healthy. Single variant (4000ms).
  console.log("Real SearXNG validation — cycle strategy (3 queries, 4s gap)");
  await runStrategy(makeCycleStrategy({ intervalMs: 4_000, priority: ["google", "duckduckgo", "brave"] }));
}

main().catch((e) => { console.error(e); process.exit(1); });
