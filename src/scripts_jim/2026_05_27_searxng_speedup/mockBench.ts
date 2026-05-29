/**
 * Mock SearXNG benchmark — deterministic head-to-head between the
 * google-only and 3-engine-cycle strategies.
 *
 * The mock models per-engine rate tolerance: if a strategy fires faster than
 * `tripQpm` queries-per-minute sustained against an engine, that engine
 * goes "suspended" for `suspendDurS` seconds (returning 0 results during
 * the cool-down). After the cool-down lifts, queries succeed again at 10
 * results each in MOCK_LATENCY_MS.
 *
 * Per-engine profiles roughly match what we observed empirically:
 *   - google: relatively low tolerance (10 qpm), long suspension (185s),
 *             but the most desirable result quality
 *   - duckduckgo: medium tolerance (30 qpm), short suspension (60s)
 *   - brave: medium tolerance (20 qpm), medium suspension (120s)
 *
 * This lets us compare:
 *   - "google-only respectful rate" — too slow, perfect hits
 *   - "google-only aggressive rate" — fast but lots of 185s waits
 *   - "3-engine cycle" — google when it works, fallover when not
 *
 * No real HTTP. Run:
 *   bun run src/scripts_jim/2026_05_27_searxng_speedup/mockBench.ts
 */

import PQueue from "p-queue";

const N_TWEETS = Number(process.env.N_TWEETS) || 100;
const QUERIES_PER_TWEET = Number(process.env.QUERIES_PER_TWEET) || 3;
const TWEET_CONCURRENCY = Number(process.env.TWEET_CONCURRENCY) || 5;
const MOCK_LATENCY_MS = 600;

// Per-engine rate-tolerance profiles. Tuned to roughly match observed
// behavior (Google blocks aggressively; Brave/DDG more tolerant).
interface EngineProfile {
  name: string;
  tripQpm: number;        // queries-per-minute that triggers suspension
  suspendDurS: number;    // how long the engine stays suspended
  intermittentZeroRate: number; // probability a query returns 0 even when not suspended (DDG CAPTCHA noise)
}

const PROFILES: Record<string, EngineProfile> = {
  google: { name: "google", tripQpm: 10, suspendDurS: 185, intermittentZeroRate: 0 },
  duckduckgo: { name: "duckduckgo", tripQpm: 30, suspendDurS: 60, intermittentZeroRate: 0.2 },
  brave: { name: "brave", tripQpm: 20, suspendDurS: 120, intermittentZeroRate: 0 },
};

interface EngineState {
  recentTimestamps: number[]; // sliding window of query starts (last 60s)
  suspendedUntil: number;
  totalQueries: number;
  trippedQueries: number; // returned 0 because suspended
  intermittentZeroes: number;
}

function makeEngineState(): EngineState {
  return { recentTimestamps: [], suspendedUntil: 0, totalQueries: 0, trippedQueries: 0, intermittentZeroes: 0 };
}

// Mock SearXNG instance. Exposes (a) a per-engine fetch and (b) a
// /stats/errors-equivalent for the strategies' suspension-detection logic.
function makeMockSearXNG() {
  const states = new Map<string, EngineState>();
  for (const eng of Object.keys(PROFILES)) states.set(eng, makeEngineState());

  async function fetchEngine(engine: string): Promise<{ results: number; suspended: boolean }> {
    const profile = PROFILES[engine];
    if (!profile) return { results: 0, suspended: false };
    const state = states.get(engine)!;
    state.totalQueries++;

    const now = Date.now();
    state.recentTimestamps.push(now);
    const cutoff = now - 60_000;
    while (state.recentTimestamps.length && state.recentTimestamps[0]! < cutoff) state.recentTimestamps.shift();

    // Trip rule: if the last 60s has more than tripQpm queries, suspend now.
    if (state.recentTimestamps.length > profile.tripQpm && now >= state.suspendedUntil) {
      state.suspendedUntil = now + profile.suspendDurS * 1000;
    }

    const jitter = (Math.random() - 0.5) * 200;
    await new Promise((r) => setTimeout(r, MOCK_LATENCY_MS + jitter));

    if (Date.now() < state.suspendedUntil) {
      state.trippedQueries++;
      return { results: 0, suspended: true };
    }
    if (profile.intermittentZeroRate > 0 && Math.random() < profile.intermittentZeroRate) {
      state.intermittentZeroes++;
      return { results: 0, suspended: false };
    }
    return { results: 10, suspended: false };
  }

  function reportedSuspendedS(engine: string): number {
    const s = states.get(engine);
    if (!s) return 0;
    return Date.now() < s.suspendedUntil ? PROFILES[engine]!.suspendDurS : 0;
  }

  return { fetchEngine, reportedSuspendedS, states };
}

// ---------------------------------------------------------------------------
// Mock strategies (mirror the production strategies but call mock.fetchEngine)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SUSPENSION_BUFFER_MS = 5_000;
const DEFAULT_SUSPENSION_S = 180;
const CANARY = "wikipedia"; // unused in mock, kept for parity

interface Strategy {
  name: string;
  fetch(query: string): Promise<{ results: number; engineUsed?: string; waitedMs: number }>;
}

function makeGoogleOnlyStrategy(mock: ReturnType<typeof makeMockSearXNG>, intervalMs: number): Strategy {
  const queue = new PQueue({ concurrency: 1, interval: intervalMs, intervalCap: 1 });
  let suspendedUntil = 0;
  return {
    name: `B_google_only_${intervalMs}ms`,
    async fetch() {
      let waited = 0;
      while (Date.now() < suspendedUntil) {
        const w = suspendedUntil - Date.now();
        waited += w;
        await sleep(w);
      }
      let r = (await queue.add(() => mock.fetchEngine("google")))!;
      if (r.results === 0) {
        const susp = mock.reportedSuspendedS("google");
        const cool = susp > 0 ? susp : DEFAULT_SUSPENSION_S;
        suspendedUntil = Math.max(suspendedUntil, Date.now() + cool * 1000 + SUSPENSION_BUFFER_MS);
        const w = suspendedUntil - Date.now();
        if (w > 0) {
          waited += w;
          await sleep(w);
          r = (await queue.add(() => mock.fetchEngine("google")))!;
        }
      }
      return { results: r.results, engineUsed: r.results > 0 ? "google" : undefined, waitedMs: waited };
    },
  };
}

function makeCycleStrategy(mock: ReturnType<typeof makeMockSearXNG>, opts: { intervalMs: number; priority: string[] }): Strategy {
  const queues = new Map<string, PQueue>();
  const suspendedUntil = new Map<string, number>();
  for (const e of opts.priority) {
    queues.set(e, new PQueue({ concurrency: 1, interval: opts.intervalMs, intervalCap: 1 }));
    suspendedUntil.set(e, 0);
  }
  const pickAvail = (): string | null => {
    const now = Date.now();
    for (const e of opts.priority) {
      if ((suspendedUntil.get(e) ?? 0) <= now) return e;
    }
    return null;
  };
  const soonestRecoveryMs = (): number => {
    const now = Date.now();
    let s = Infinity;
    for (const e of opts.priority) {
      const u = suspendedUntil.get(e) ?? 0;
      if (u > now) s = Math.min(s, u - now);
    }
    return s === Infinity ? 0 : s;
  };
  return {
    name: `C_cycle_${opts.priority.join("+")}_${opts.intervalMs}ms`,
    async fetch() {
      let waited = 0;
      for (let pass = 0; pass < 2; pass++) {
        while (true) {
          const eng = pickAvail();
          if (!eng) break;
          const r = (await queues.get(eng)!.add(() => mock.fetchEngine(eng)))!;
          if (r.results > 0) return { results: r.results, engineUsed: eng, waitedMs: waited };
          const susp = mock.reportedSuspendedS(eng);
          if (susp > 0) {
            suspendedUntil.set(eng, Date.now() + susp * 1000 + SUSPENSION_BUFFER_MS);
          } else {
            // Engine returned 0 but not suspended — intermittent failure
            // (DDG CAPTCHA noise). Short cool-down to deprioritize it.
            suspendedUntil.set(eng, Date.now() + 30 * 1000 + SUSPENSION_BUFFER_MS);
          }
        }
        const w = soonestRecoveryMs();
        if (w <= 0) break;
        waited += w;
        await sleep(w);
      }
      return { results: 0, waitedMs: waited };
    },
  };
}

// Current shipped baseline — for comparison.
function makeCurrentStrategy(mock: ReturnType<typeof makeMockSearXNG>): Strategy {
  return makeGoogleOnlyStrategy(mock, 8_000);
}

// ---------------------------------------------------------------------------
// Bench harness
// ---------------------------------------------------------------------------

interface BenchSummary {
  strategy: string;
  wallSeconds: number;
  totalQueries: number;
  hitQueries: number;
  zeroQueries: number;
  zeroTweets: number;
  byEngine: Record<string, number>;
  totalWaitedSeconds: number;
}

async function runStrategy(strategy: Strategy, mock: ReturnType<typeof makeMockSearXNG>): Promise<BenchSummary> {
  const queue = new PQueue({ concurrency: TWEET_CONCURRENCY });
  let hits = 0, zero = 0, zeroTweets = 0;
  let totalWaitedMs = 0;
  const byEngine: Record<string, number> = {};

  const start = Date.now();
  for (let t = 0; t < N_TWEETS; t++) {
    queue.add(async () => {
      let tweetHits = 0;
      for (let q = 0; q < QUERIES_PER_TWEET; q++) {
        const r = await strategy.fetch(`t${t}_q${q}`);
        totalWaitedMs += r.waitedMs;
        if (r.results > 0) {
          hits++;
          tweetHits += r.results;
          if (r.engineUsed) byEngine[r.engineUsed] = (byEngine[r.engineUsed] ?? 0) + 1;
        } else zero++;
      }
      if (tweetHits === 0) zeroTweets++;
    });
  }
  await queue.onIdle();
  return {
    strategy: strategy.name,
    wallSeconds: (Date.now() - start) / 1000,
    totalQueries: hits + zero,
    hitQueries: hits,
    zeroQueries: zero,
    zeroTweets,
    byEngine,
    totalWaitedSeconds: totalWaitedMs / 1000,
  };
}

async function main() {
  console.log(`Mock bench: ${N_TWEETS} tweets × ${QUERIES_PER_TWEET} q, concurrency=${TWEET_CONCURRENCY}`);
  console.log(`Profiles: google trips at ${PROFILES.google!.tripQpm}qpm (susp ${PROFILES.google!.suspendDurS}s); ddg ${PROFILES.duckduckgo!.tripQpm}qpm/${PROFILES.duckduckgo!.suspendDurS}s; brave ${PROFILES.brave!.tripQpm}qpm/${PROFILES.brave!.suspendDurS}s`);

  // 8000ms and 6000ms B (google-only) already collected (232.5s / 174.7s,
  // no trips). 4000ms google-only is predictably slow (15qpm > 10 trip
  // threshold, so 30q × 4s queue + 3 × 185s wait ≈ 700s). Cycle strategies
  // are where the wins are.
  const summaries: BenchSummary[] = [];
  const strategyFactories: Array<(m: ReturnType<typeof makeMockSearXNG>) => Strategy> = [
    (m) => makeCycleStrategy(m, { intervalMs: 6_000, priority: ["google", "duckduckgo", "brave"] }),
    (m) => makeCycleStrategy(m, { intervalMs: 4_000, priority: ["google", "duckduckgo", "brave"] }),
    (m) => makeCycleStrategy(m, { intervalMs: 3_000, priority: ["google", "duckduckgo", "brave"] }),
  ];
  for (const factory of strategyFactories) {
    const mock = makeMockSearXNG();
    const strategy = factory(mock);
    console.log(`\n----- ${strategy.name} -----`);
    const sum = await runStrategy(strategy, mock);
    summaries.push(sum);
    console.log(`  wall=${sum.wallSeconds.toFixed(1)}s  hits=${sum.hitQueries}/${sum.totalQueries}  zero-tweets=${sum.zeroTweets}/${N_TWEETS}  waited=${sum.totalWaitedSeconds.toFixed(0)}s  by_engine=${JSON.stringify(sum.byEngine)}`);
  }

  console.log("\n========== SUMMARY ==========");
  const header = ["strategy", "wall(s)", "hits", "zero-tw", "wait(s)", "by_engine"];
  console.log(header.map((h, i) => i === 0 ? h.padEnd(48) : h.padStart(11)).join(""));
  for (const s of summaries) {
    console.log(
      s.strategy.padEnd(48) +
      s.wallSeconds.toFixed(1).padStart(11) +
      `${s.hitQueries}/${s.totalQueries}`.padStart(11) +
      `${s.zeroTweets}/${N_TWEETS}`.padStart(11) +
      s.totalWaitedSeconds.toFixed(0).padStart(11) +
      ("  " + JSON.stringify(s.byEngine))
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
