/**
 * Mock pipeline benchmark — Google-only SearXNG strategies.
 *
 * Drives N "tweets" × Q queries per tweet through each strategy, with the
 * top-level PQueue at concurrency K matching localPipelineRunner. No real
 * LLM calls — each "tweet" is just (search × Q) sandwiched between optional
 * mock-delays simulating writer/judge/verifier latency. The actual SearXNG
 * server is hit, so engine rate-limit / suspension behavior is real.
 *
 * Output: per-strategy wall time, hit rate, suspended-query count.
 *
 * Run:
 *   bun run src/scripts_jim/2026_05_27_searxng_speedup/bench.ts <strategy_names_or_all>
 *
 * Knobs (env vars):
 *   N_TWEETS=100              tweets per strategy
 *   QUERIES_PER_TWEET=3       queries per tweet
 *   TWEET_CONCURRENCY=5       top-level parallelism
 *   MOCK_LLM_DELAY_MS=0       simulated writer/judge/verifier per stage
 *   COOLOFF_S=20              gap between strategies so engine state resets
 */

import PQueue from "p-queue";
import {
  makeCurrentStrategy,
  makeFastNoWaitStrategy,
  makePacedNoWaitStrategy,
  makeBoundedConcurrencyStrategy,
  type FetchResult,
} from "./strategies";

const N_TWEETS = Number(process.env.N_TWEETS) || 100;
const QUERIES_PER_TWEET = Number(process.env.QUERIES_PER_TWEET) || 3;
const TWEET_CONCURRENCY = Number(process.env.TWEET_CONCURRENCY) || 5;
const MOCK_LLM_DELAY_MS = Number(process.env.MOCK_LLM_DELAY_MS) || 0;
const COOLOFF_S = Number(process.env.COOLOFF_S) || 20;

interface Strategy { name: string; fetch(query: string): Promise<FetchResult> }

interface BenchSummary {
  strategy: string;
  wallSeconds: number;
  totalQueries: number;
  queriesWithResults: number;
  queriesZero: number;
  queriesSuspended: number;
  queriesError: number;
  meanQueryMs: number;
  p95QueryMs: number;
  maxQueryMs: number;
  totalResults: number;
  tweetsAllZero: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function p95(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(Math.floor(s.length * 0.95), s.length - 1)]!;
}

// Build realistic, distinct queries so SearXNG cache can't trivially short-
// circuit and so each query roughly looks like a different fact-check.
function buildQueries(): string[][] {
  const topics = [
    "trump tariff steel 2024", "biden inflation 2024", "china taiwan invasion threat",
    "climate change ocean temperature record", "elon musk neuralink demo",
    "openai gpt5 announcement", "ukraine drone strikes kursk",
    "fed interest rate decision 2024", "supreme court abortion ruling 2024",
    "covid origin lab leak report", "amazon rainforest deforestation 2024",
    "ev tesla recall 2024", "israel gaza ceasefire talks", "uk election labour win",
    "boeing 737 safety report 2024", "apple vision pro sales", "russia sanctions oil",
    "north korea missile test 2024", "venezuela election results 2024",
    "argentina milei economy", "japan earthquake 2024 noto", "india election modi",
    "germany afd election", "france macron pension reform", "iran israel attack",
    "south africa election anc", "indonesia election prabowo", "brazil floods 2024",
    "spain elections sanchez", "italy meloni migration",
  ];
  const out: string[][] = [];
  const runTag = `r${Date.now() % 100000}`;
  for (let t = 0; t < N_TWEETS; t++) {
    const topic = topics[t % topics.length]!;
    const tweetQueries: string[] = [];
    for (let q = 0; q < QUERIES_PER_TWEET; q++) {
      tweetQueries.push(`${topic} ${runTag} t${t} q${q}`);
    }
    out.push(tweetQueries);
  }
  return out;
}

async function runStrategy(strategy: Strategy, queries: string[][]): Promise<BenchSummary> {
  const queue = new PQueue({ concurrency: TWEET_CONCURRENCY });
  const durations: number[] = [];
  let withResults = 0, zero = 0, suspended = 0, errored = 0;
  let totalResults = 0, tweetsAllZero = 0;

  const start = Date.now();
  let printed = 0;
  for (const [i, tq] of queries.entries()) {
    queue.add(async () => {
      if (MOCK_LLM_DELAY_MS) await sleep(MOCK_LLM_DELAY_MS);
      let tweetHits = 0;
      for (const q of tq) {
        const r = await strategy.fetch(q);
        durations.push(r.durationMs);
        totalResults += r.results;
        if (r.error) errored++;
        if (r.suspended) suspended++;
        if (r.results > 0) withResults++;
        else zero++;
        tweetHits += r.results;
      }
      if (tweetHits === 0) tweetsAllZero++;
      if (MOCK_LLM_DELAY_MS) await sleep(MOCK_LLM_DELAY_MS * 3);
      printed++;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      // Print at most ~20 lines so a 100-tweet run stays readable
      if (printed % Math.max(1, Math.floor(queries.length / 20)) === 0 || printed === queries.length) {
        console.log(`  [${elapsed}s] tweet ${printed}/${queries.length} (hits=${tweetHits}, susp_total=${suspended})`);
      }
    });
  }
  await queue.onIdle();
  const wallSeconds = (Date.now() - start) / 1000;
  const meanMs = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);

  return {
    strategy: strategy.name,
    wallSeconds,
    totalQueries: durations.length,
    queriesWithResults: withResults,
    queriesZero: zero,
    queriesSuspended: suspended,
    queriesError: errored,
    meanQueryMs: Math.round(meanMs),
    p95QueryMs: Math.round(p95(durations)),
    maxQueryMs: Math.round(Math.max(0, ...durations)),
    totalResults,
    tweetsAllZero,
  };
}

async function main() {
  const requested = (process.argv[2] ?? "all").toLowerCase();
  const all: Record<string, () => Strategy> = {
    a: makeCurrentStrategy,
    b: makeFastNoWaitStrategy,
    c_1s_c4: () => makePacedNoWaitStrategy(1_000, 4),
    c_2s_c4: () => makePacedNoWaitStrategy(2_000, 4),
    d_c4: () => makeBoundedConcurrencyStrategy(4),
    d_c8: () => makeBoundedConcurrencyStrategy(8),
  };

  const picks: Strategy[] = [];
  if (requested === "all") for (const k of Object.keys(all)) picks.push(all[k]!());
  else for (const k of requested.split(",").map((s) => s.trim())) {
    const f = all[k];
    if (!f) { console.error(`Unknown strategy: ${k}. Available: ${Object.keys(all).join(", ")}`); process.exit(1); }
    picks.push(f());
  }

  console.log(`Bench: ${N_TWEETS} tweets × ${QUERIES_PER_TWEET} q, concurrency=${TWEET_CONCURRENCY}, mockLLM=${MOCK_LLM_DELAY_MS}ms, cooloff=${COOLOFF_S}s`);
  console.log(`Total queries per strategy: ${N_TWEETS * QUERIES_PER_TWEET}`);

  const queries = buildQueries();
  const summaries: BenchSummary[] = [];
  for (const [i, s] of picks.entries()) {
    console.log(`\n========== ${s.name} ==========`);
    const sum = await runStrategy(s, queries);
    summaries.push(sum);
    console.log(`  Wall: ${sum.wallSeconds.toFixed(1)}s | results-q: ${sum.queriesWithResults}/${sum.totalQueries} | suspended-q: ${sum.queriesSuspended} | err-q: ${sum.queriesError} | zero-tweet: ${sum.tweetsAllZero}/${queries.length} | mean: ${sum.meanQueryMs}ms p95: ${sum.p95QueryMs}ms max: ${sum.maxQueryMs}ms`);
    if (i < picks.length - 1) {
      console.log(`  (cool-off ${COOLOFF_S}s)`);
      await sleep(COOLOFF_S * 1000);
    }
  }

  console.log("\n\n========== SUMMARY ==========");
  const header = ["strategy", "wall(s)", "hit-q", "0-q", "susp", "err", "0-tweets", "mean", "p95"];
  console.log(header.map((h, i) => i === 0 ? h.padEnd(40) : h.padStart(9)).join(""));
  for (const s of summaries) {
    console.log(
      s.strategy.padEnd(40) +
      s.wallSeconds.toFixed(1).padStart(9) +
      `${s.queriesWithResults}`.padStart(9) +
      `${s.queriesZero}`.padStart(9) +
      `${s.queriesSuspended}`.padStart(9) +
      `${s.queriesError}`.padStart(9) +
      `${s.tweetsAllZero}`.padStart(9) +
      `${s.meanQueryMs}`.padStart(9) +
      `${s.p95QueryMs}`.padStart(9)
    );
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
