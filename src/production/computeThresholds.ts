/**
 * Compute optimal submission thresholds via MDP value iteration.
 *
 * Solves an admission control problem: given WL submission slots (each on 24h cooldown),
 * what's the minimum eval score to submit when k slots are free?
 *
 * Usage:
 *   bun run src/production/computeThresholds.ts
 *   bun run src/production/computeThresholds.ts --local
 */

const isLocal = process.argv.includes("--local");
if (isLocal) {
  const localUrl = process.env.LOCAL_SUPABASE_URL;
  const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
  if (localUrl && localKey) {
    process.env.SUPABASE_URL = localUrl;
    process.env.SUPABASE_SERVICE_KEY = localKey;
    console.log(`[thresholds] Using local Supabase at ${localUrl}`);
  } else {
    console.error("[thresholds] --local requires LOCAL_SUPABASE_URL and LOCAL_SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
}

import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";

// ── Config ──────────────────────────────────────────────────────────

const HALF_LIFE_DAYS = 30;
const ALPHA = Math.LN2 / HALF_LIFE_DAYS;
const NUM_BINS = 5;
const MU = 1 / 24; // slot recovery rate (per hour)
const MIN_WL = 2;
const MAX_WL = 500;
const VALUE_ITER_EPSILON = 1e-8;
const VALUE_ITER_MAX = 10_000;

// ── Types ───────────────────────────────────────────────────────────

type NoteRow = {
  note_id: string;
  evaluation_score: number | null;
  submitted_at: string;
  cn_status: string | null;
};

type CanonicalRow = {
  note_id: string;
  cn_status: string | null;
  most_recent_non_nmr_status: string | null;
  locked_status: string | null;
  first_non_nmr_status: string | null;
  classification: string | null;
};

type PipelineRunRow = {
  outcome: string;
  created_at: string;
};

type Bin = {
  lo: number;
  hi: number;
  midpoint: number;
  weightedHelpful: number;
  weightedTotal: number;
  reward: number; // P(helpful | score in bin)
};

type MDPResult = {
  wl: number;
  h: number[];
  thresholds: number[];
  gain: number;
};

// ── Outcome classification ──────────────────────────────────────────

function classifyOutcome(
  note: NoteRow,
  canonical: Map<string, CanonicalRow>
): "helpful" | "unhelpful" | "nmr" {
  const c = canonical.get(note.note_id);
  const raw = c
    ? c.locked_status || c.most_recent_non_nmr_status || c.first_non_nmr_status || c.classification || c.cn_status || ""
    : note.cn_status || "";
  const s = raw.toLowerCase();
  if (s.includes("currently_rated_helpful") && !s.includes("not")) return "helpful";
  if (s.includes("not_helpful") || s.includes("currently_rated_not_helpful")) return "unhelpful";
  if (s.includes("helpful") && !s.includes("not")) return "helpful";
  return "nmr";
}

// ── Exponential weight ──────────────────────────────────────────────

function weight(dateStr: string, now: number): number {
  const ageDays = (now - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-ALPHA * ageDays);
}

// ── Parameter estimation ────────────────────────────────────────────

function estimateLambda(runs: PipelineRunRow[]): { lambda: number; totalWeight: number; dateRange: string } {
  if (runs.length === 0) throw new Error("No pipeline runs found");
  const now = Date.now();
  const dates = runs.map((r) => new Date(r.created_at).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const totalHours = (maxDate - minDate) / (1000 * 60 * 60);
  const totalWeight = runs.reduce((sum, r) => sum + weight(r.created_at, now), 0);
  const lambda = totalWeight / Math.max(totalHours, 1);
  const dateRange = `${new Date(minDate).toISOString().slice(0, 10)} to ${new Date(maxDate).toISOString().slice(0, 10)}`;
  return { lambda, totalWeight, dateRange };
}

// ── Reward function & score distribution ────────────────────────────

function buildBins(notes: NoteRow[], canonical: Map<string, CanonicalRow>): { bins: Bin[]; scoreDist: number[] } {
  const now = Date.now();

  // Compute weight and outcome for each note, sort by eval score
  const weighted = notes
    .map((n) => ({
      score: n.evaluation_score!,
      weight: weight(n.submitted_at, now),
      helpful: classifyOutcome(n, canonical) === "helpful",
    }))
    .sort((a, b) => a.score - b.score);

  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  const weightPerBin = totalWeight / NUM_BINS;

  // Split into NUM_BINS equal-weight bins
  const bins: Bin[] = [];
  let binStart = 0;
  let cumWeight = 0;
  let cumHelpful = 0;

  for (let i = 0; i < weighted.length; i++) {
    cumWeight += weighted[i]!.weight;
    if (weighted[i]!.helpful) cumHelpful += weighted[i]!.weight;

    const isLastNote = i === weighted.length - 1;
    const binFull = cumWeight >= weightPerBin && bins.length < NUM_BINS - 1;

    if (binFull || isLastNote) {
      bins.push({
        lo: weighted[binStart]!.score,
        hi: weighted[i]!.score,
        midpoint: (weighted[binStart]!.score + weighted[i]!.score) / 2,
        weightedHelpful: cumHelpful,
        weightedTotal: cumWeight,
        reward: cumWeight > 0 ? cumHelpful / cumWeight : 0,
      });
      binStart = i + 1;
      cumWeight = 0;
      cumHelpful = 0;
    }
  }

  const scoreDist = bins.map((b) => b.weightedTotal / totalWeight);
  return { bins, scoreDist };
}

// ── MDP value iteration ─────────────────────────────────────────────

function arrivalValue(k: number, h: number[], bins: Bin[], scoreDist: number[]): number {
  if (k === 0) return h[0]!;
  let val = 0;
  for (let i = 0; i < bins.length; i++) {
    const accept = bins[i]!.reward + h[k - 1]!;
    const reject = h[k]!;
    val += scoreDist[i]! * Math.max(accept, reject);
  }
  return val;
}

function solveForWL(wl: number, lambda: number, bins: Bin[], scoreDist: number[]): MDPResult {
  const n = wl + 1; // states 0..wl
  const Lambda = lambda + wl * MU;
  let h = new Array(n).fill(0);
  let gain = 0;

  let iter = 0;
  for (; iter < VALUE_ITER_MAX; iter++) {
    const hNew = new Array(n).fill(0);
    for (let k = 0; k < n; k++) {
      const departures = (wl - k) * MU;
      const selfLoop = Lambda - lambda - departures;
      const nextK = Math.min(k + 1, wl);
      hNew[k] =
        (lambda * arrivalValue(k, h, bins, scoreDist) +
          departures * h[nextK]! +
          selfLoop * h[k]!) /
        Lambda;
    }
    // Gain = h_new(0) before normalization (average reward rate)
    gain = hNew[0]!;
    // Normalize h(0) = 0
    for (let k = 0; k < n; k++) hNew[k] -= gain;

    // Check convergence
    let maxDiff = 0;
    for (let k = 0; k < n; k++) maxDiff = Math.max(maxDiff, Math.abs(hNew[k]! - h[k]!));
    h = hNew;
    if (maxDiff < VALUE_ITER_EPSILON) break;
  }

  // Extract thresholds: s*(k) = h(k) - h(k-1) for k >= 1
  const thresholds = [NaN]; // k=0 has no threshold
  for (let k = 1; k < n; k++) thresholds.push(h[k]! - h[k - 1]!);

  return { wl, h, thresholds, gain };
}

// ── Threshold to eval score mapping ─────────────────────────────────

function rewardToEvalScore(rewardThreshold: number, bins: Bin[]): number | null {
  // Linear interpolation: find where the reward function crosses the threshold
  // Use monotonic envelope (cumulative max from right) to handle non-monotonicity
  if (rewardThreshold <= 0) return bins[0]!.lo; // accept everything

  // Build monotonic reward curve (isotonic regression from right — higher scores should have higher reward)
  const monoReward = bins.map((b) => b.reward);
  for (let i = monoReward.length - 2; i >= 0; i--) {
    monoReward[i] = Math.min(monoReward[i]!, monoReward[i + 1]!);
  }

  // If threshold below minimum reward, accept everything
  if (rewardThreshold <= monoReward[0]!) return bins[0]!.lo;
  // If threshold above maximum reward, never accept
  if (rewardThreshold > monoReward[monoReward.length - 1]!) return null;

  // Linear interpolation between bin midpoints
  for (let i = 0; i < bins.length - 1; i++) {
    if (monoReward[i]! <= rewardThreshold && monoReward[i + 1]! >= rewardThreshold) {
      const frac = (rewardThreshold - monoReward[i]!) / (monoReward[i + 1]! - monoReward[i]!);
      return bins[i]!.midpoint + frac * (bins[i + 1]!.midpoint - bins[i]!.midpoint);
    }
  }
  return bins[bins.length - 1]!.midpoint;
}

// ── Logging ─────────────────────────────────────────────────────────

function logDataSummary(notes: NoteRow[], canonical: Map<string, CanonicalRow>, runs: PipelineRunRow[]) {
  const outcomes = { helpful: 0, unhelpful: 0, nmr: 0 };
  for (const n of notes) outcomes[classifyOutcome(n, canonical)]++;
  console.log("\n=== DATA SUMMARY ===");
  console.log(`  Notes with eval scores:  ${notes.length}`);
  console.log(`  Canonical records:       ${canonical.size}`);
  console.log(`  Pipeline runs (cand/sub): ${runs.length}`);
  console.log(`  Outcomes: ${outcomes.helpful} helpful, ${outcomes.unhelpful} unhelpful, ${outcomes.nmr} nmr`);
}

function logWeightingConfig() {
  console.log("\n=== EXPONENTIAL WEIGHTING ===");
  console.log(`  Half-life:  ${HALF_LIFE_DAYS} days`);
  console.log(`  α (decay):  ${ALPHA.toFixed(6)} per day`);
}

function logLambda(est: { lambda: number; totalWeight: number; dateRange: string }) {
  console.log("\n=== ARRIVAL RATE (λ) ===");
  console.log(`  Date range:       ${est.dateRange}`);
  console.log(`  Effective samples: ${est.totalWeight.toFixed(1)}`);
  console.log(`  λ = ${est.lambda.toFixed(4)} candidates/hour = ${(est.lambda * 24).toFixed(1)} candidates/day`);
  console.log(`  μ = ${MU.toFixed(6)} per hour (1 slot recovers per 24h)`);
}

function logScoreDistribution(bins: Bin[], scoreDist: number[]) {
  console.log("\n=== SCORE DISTRIBUTION F ===");
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]!;
    console.log(`  ${b.lo.toFixed(2).padStart(6)} - ${b.hi.toFixed(2).padStart(5)}: ${(scoreDist[i]! * 100).toFixed(1).padStart(5)}%  (eff. n=${b.weightedTotal.toFixed(1)})`);
  }
}

function logRewardFunction(bins: Bin[]) {
  console.log("\n=== REWARD FUNCTION r(s) = P(helpful) ===");
  console.log("  Bin range        | midpoint | w.helpful | w.total | r(s)");
  console.log("  " + "-".repeat(60));
  for (const b of bins) {
    console.log(
      `  ${b.lo.toFixed(2).padStart(6)} - ${b.hi.toFixed(2).padStart(5)} | ${b.midpoint.toFixed(2).padStart(8)} | ${b.weightedHelpful.toFixed(1).padStart(9)} | ${b.weightedTotal.toFixed(1).padStart(7)} | ${b.reward.toFixed(3).padStart(6)}`
    );
  }
}

function logMDPResults(results: MDPResult[], bins: Bin[], lambda: number) {
  const minReward = Math.min(...bins.map((b) => b.reward));
  console.log("\n=== MDP RESULTS ===");
  console.log("  WL | helpful/day | reward thresholds s*(k) at k=1,2,3,5,10 | eval score thresholds");
  console.log("  " + "-".repeat(95));

  for (const r of results) {
    const Lambda = lambda + r.wl * MU;
    const helpfulPerDay = r.gain * Lambda * 24;
    const sampleKs = [1, 2, 3, 5, 10].filter((k) => k <= r.wl);
    const rewardThresholds = sampleKs.map((k) => `${r.thresholds[k]!.toFixed(3)}`).join("  ");
    const evalThresholds = sampleKs
      .map((k) => {
        if (r.thresholds[k]! <= minReward) return "all";
        const es = rewardToEvalScore(r.thresholds[k]!, bins);
        return es !== null ? es.toFixed(2) : "never";
      })
      .join("  ");
    console.log(
      `  ${String(r.wl).padStart(3)} | ${helpfulPerDay.toFixed(2).padStart(10)} | ${rewardThresholds.padEnd(40)} | ${evalThresholds}`
    );
  }
}

function logDetailedWL(result: MDPResult, bins: Bin[]) {
  console.log(`\n=== DETAILED: WL = ${result.wl} ===`);
  console.log("  k (free slots) | h(k)    | threshold s*(k) | min eval score to submit");
  console.log("  " + "-".repeat(70));
  for (let k = 0; k <= result.wl; k++) {
    const threshold = k === 0 ? "N/A" : result.thresholds[k]!.toFixed(6);
    const evalScore =
      k === 0 ? "N/A" : (() => { const es = rewardToEvalScore(result.thresholds[k]!, bins); return es !== null ? es.toFixed(3) : "never"; })();
    console.log(
      `  ${String(k).padStart(15)} | ${result.h[k]!.toFixed(5).padStart(7)} | ${String(threshold).padStart(15)} | ${evalScore}`
    );
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const logger = new SupabaseLogger();

  // Fetch data
  console.log("[thresholds] Fetching data...");
  const [notes, canonicalRows, runs] = await Promise.all([
    logger.fetchAllRows<NoteRow>((c) =>
      c.from("notes").select("note_id, evaluation_score, submitted_at, cn_status").not("evaluation_score", "is", null)
    ),
    logger.fetchAllRows<CanonicalRow>((c) =>
      c.from("canonical_note_information").select("note_id, cn_status, most_recent_non_nmr_status, locked_status, first_non_nmr_status, classification")
    ),
    logger.fetchAllRows<PipelineRunRow>((c) =>
      c.from("pipeline_runs").select("outcome, created_at").in("outcome", ["candidate", "submitted"])
    ),
  ]);
  const canonical = new Map(canonicalRows.map((r) => [r.note_id, r]));

  logDataSummary(notes, canonical, runs);
  logWeightingConfig();

  // Estimate λ
  const lambdaEst = estimateLambda(runs);
  logLambda(lambdaEst);

  // Build reward function and score distribution
  const { bins, scoreDist } = buildBins(notes, canonical);
  logScoreDistribution(bins, scoreDist);
  logRewardFunction(bins);

  // Solve MDP for each WL
  console.log(`\n[thresholds] Solving MDP for WL = ${MIN_WL}..${MAX_WL}...`);
  const results: MDPResult[] = [];
  for (let wl = MIN_WL; wl <= MAX_WL; wl++) {
    results.push(solveForWL(wl, lambdaEst.lambda, bins, scoreDist));
  }
  console.log(`[thresholds] Done. ${results.length} WL values solved.`);

  // Log summary of all WLs (sampled)
  const sampledWLs = [2, 3, 5, 10, 15, 20, 30, 50, 100, 200, 500];
  const sampledResults = results.filter((r) => sampledWLs.includes(r.wl));
  logMDPResults(sampledResults, bins, lambdaEst.lambda);

  // Detailed output for current WL
  const currentWLStr = await logger.getPipelineState("writing_limit");
  const currentWL = currentWLStr ? parseInt(currentWLStr) : 10;
  const currentResult = results.find((r) => r.wl === Math.min(Math.max(currentWL, MIN_WL), MAX_WL));
  if (currentResult) {
    console.log(`\n[thresholds] Current writing limit from pipeline_state: ${currentWL}`);
    logDetailedWL(currentResult, bins);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
