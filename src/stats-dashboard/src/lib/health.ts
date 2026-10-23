export interface HealthRun {
  id: string;
  tweet_id: string | null;
  created_at: string;
  outcome: string | null;
  outcome_reason: string | null;
  final_stage: string | null;
  commit_sha: string | null;
  prefilter_elapsed_ms: number | string | null;
  prefilter_timeout: unknown;
}

export interface HealthPeriod {
  attempts: number;
  completed: number;
  failed: number;
  overdue: number;
  active: number;
  unknown: number;
  submitted: number;
  candidates: number;
  rejected: number;
  filtered: number;
  completionRate: number | null;
  precheckSamples: number;
  precheckTimeouts: number;
  precheckMedianMs: number | null;
  precheckP90Ms: number | null;
}

export interface HealthCapacity {
  canSubmit: boolean;
  signalQueued: number;
  inFlight: number;
  used24h: number;
  nextAttemptAt: string | null;
  probe: boolean;
}

export interface PipelineHealth {
  generated_at: string;
  mode: "live" | "snapshot";
  recent: HealthPeriod;
  baseline: HealthPeriod;
  latestAttemptAt: string | null;
  latestSubmissionAt: string | null;
  overdueTotal: number;
  capacity: HealthCapacity | null;
  capacityIssue?: "legacy_reserve" | "unavailable";
  reasons: { outcome: string; reason: string; count: number }[];
  examples: HealthRun[];
}

export interface HealthAlert {
  severity: "warning" | "error";
  message: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OVERDUE_MS = 30 * 60 * 1000;
const SLOW_PRECHECK_MS = 95_000;

function elapsedMs(run: HealthRun): number | null {
  const raw = run.prefilter_elapsed_ms;
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function timedOut(run: HealthRun): boolean {
  const timeout = run.prefilter_timeout;
  return typeof timeout === "object" && timeout !== null &&
    "action" in timeout && timeout.action === "fail_open";
}

function technicalFailure(run: HealthRun): boolean {
  return run.outcome === "failed" ||
    (run.outcome === "rejected" && run.outcome_reason === "submit_error");
}

function isOverdue(run: HealthRun, asOfMs: number): boolean {
  return run.outcome === "in_progress" && asOfMs - Date.parse(run.created_at) >= OVERDUE_MS;
}

function quantile(sorted: number[], fraction: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export function summarizeHealthPeriod(runs: readonly HealthRun[], asOfMs: number): HealthPeriod {
  const summary: HealthPeriod = {
    attempts: runs.length,
    completed: 0,
    failed: 0,
    overdue: 0,
    active: 0,
    unknown: 0,
    submitted: 0,
    candidates: 0,
    rejected: 0,
    filtered: 0,
    completionRate: null,
    precheckSamples: 0,
    precheckTimeouts: 0,
    precheckMedianMs: null,
    precheckP90Ms: null,
  };
  const durations: number[] = [];

  for (const run of runs) {
    if (technicalFailure(run)) summary.failed++;
    else if (run.outcome === "in_progress") {
      if (isOverdue(run, asOfMs)) summary.overdue++;
      else if (Number.isFinite(Date.parse(run.created_at))) summary.active++;
      else summary.unknown++;
    } else if (["submitted", "candidate", "rejected", "filtered"].includes(run.outcome ?? "")) {
      summary.completed++;
    } else summary.unknown++;

    if (run.outcome === "submitted") summary.submitted++;
    if (run.outcome === "candidate") summary.candidates++;
    if (run.outcome === "rejected") summary.rejected++;
    if (run.outcome === "filtered") summary.filtered++;

    const elapsed = elapsedMs(run);
    if (elapsed !== null) durations.push(elapsed);
    if (timedOut(run)) summary.precheckTimeouts++;
  }

  const resolved = summary.completed + summary.failed + summary.overdue;
  summary.completionRate = resolved ? summary.completed / resolved : null;
  durations.sort((a, b) => a - b);
  summary.precheckSamples = durations.length;
  summary.precheckMedianMs = quantile(durations, 0.5);
  summary.precheckP90Ms = quantile(durations, 0.9);
  return summary;
}

export function buildPipelineHealth({
  runs,
  asOf,
  latestAttemptAt,
  latestSubmissionAt,
  overdueTotal,
  capacity,
}: {
  runs: readonly HealthRun[];
  asOf: string | Date;
  latestAttemptAt: string | null;
  latestSubmissionAt: string | null;
  overdueTotal: number;
  capacity: HealthCapacity | null;
}): PipelineHealth {
  const generatedAt = asOf instanceof Date ? asOf.toISOString() : asOf;
  const asOfMs = Date.parse(generatedAt);
  if (!Number.isFinite(asOfMs)) throw new Error("Invalid health snapshot timestamp");
  const recentStart = asOfMs - DAY_MS;
  const baselineStart = asOfMs - 8 * DAY_MS;
  const recent = runs.filter((run) => {
    const created = Date.parse(run.created_at);
    return created >= recentStart && created <= asOfMs;
  });
  const baseline = runs.filter((run) => {
    const created = Date.parse(run.created_at);
    return created >= baselineStart && created < recentStart;
  });
  const reasons = new Map<string, PipelineHealth["reasons"][number]>();
  for (const run of recent) {
    const outcome = run.outcome ?? "unknown";
    const reason = run.outcome_reason ?? "not_recorded";
    const key = JSON.stringify([outcome, reason]);
    const existing = reasons.get(key);
    if (existing) existing.count++;
    else reasons.set(key, { outcome, reason, count: 1 });
  }

  return {
    generated_at: generatedAt,
    mode: "snapshot",
    recent: summarizeHealthPeriod(recent, asOfMs),
    baseline: summarizeHealthPeriod(baseline, asOfMs),
    latestAttemptAt,
    latestSubmissionAt,
    overdueTotal,
    capacity,
    reasons: [...reasons.values()].sort((a, b) =>
      b.count - a.count || a.outcome.localeCompare(b.outcome) || a.reason.localeCompare(b.reason)),
    examples: recent
      .filter((run) => technicalFailure(run) || isOverdue(run, asOfMs) || timedOut(run) ||
        (elapsedMs(run) ?? 0) > SLOW_PRECHECK_MS)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id))
      .slice(0, 12)
      .map((run) => ({
        id: run.id,
        tweet_id: run.tweet_id,
        created_at: run.created_at,
        outcome: run.outcome,
        outcome_reason: run.outcome_reason,
        final_stage: run.final_stage,
        commit_sha: run.commit_sha,
        prefilter_elapsed_ms: run.prefilter_elapsed_ms,
        prefilter_timeout: run.prefilter_timeout,
      })),
  };
}

export function healthAlerts(health: PipelineHealth, nowMs: number): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  const asOfMs = Date.parse(health.generated_at);
  const freshnessLimit = health.mode === "live" ? 3 * 60 * 1000 : 6 * HOUR_MS;
  if (!Number.isFinite(asOfMs) || nowMs - asOfMs > freshnessLimit) {
    alerts.push({
      severity: "warning",
      message: health.mode === "live"
        ? "Live health data is over 3 minutes old or its timestamp is unavailable. Refresh before assessing the pipeline."
        : "Health snapshot is over 6 hours old or its timestamp is unavailable. Check the dashboard refresh job.",
    });
  }

  if (health.overdueTotal > 0) {
    alerts.push({
      severity: "error",
      message: `${health.overdueTotal} recorded attempt${health.overdueTotal === 1 ? " is" : "s are"} still in progress after 30 minutes, including older history.`,
    });
  }

  const latestAttemptMs = health.latestAttemptAt ? Date.parse(health.latestAttemptAt) : NaN;
  if (!Number.isFinite(latestAttemptMs) || asOfMs - latestAttemptMs > 2 * HOUR_MS) {
    let context = "Check the scheduler and pipeline logs.";
    if (health.capacity?.signalQueued) context = "Approved Signal notes have submission priority; check capacity and pipeline logs.";
    else if (health.capacity && !health.capacity.canSubmit) context = "Submission capacity is currently blocked; check the next retry and pipeline logs.";
    else if (health.capacity?.canSubmit) context = "Submission capacity is available; check the scheduler and pipeline logs.";
    alerts.push({
      severity: "warning",
      message: `${Number.isFinite(latestAttemptMs) ? "No recorded attempt in over 2 hours as of this data." : "No latest attempt timestamp is available."} ${context}`,
    });
  }

  const recent = health.recent;
  const recentErrors = recent.failed + recent.overdue;
  const recentResolved = recent.completed + recentErrors;
  const errorRate = recentResolved ? recentErrors / recentResolved : 0;
  const baselineErrors = health.baseline.failed + health.baseline.overdue;
  const baselineResolved = health.baseline.completed + baselineErrors;
  const baselineRate = baselineResolved ? baselineErrors / baselineResolved : 0;
  const regressed = baselineResolved >= 20 && errorRate >= baselineRate * 2 &&
    20 * (recentErrors * baselineResolved - baselineErrors * recentResolved) >= recentResolved * baselineResolved;
  if (recentErrors >= 3 && (errorRate >= 0.1 || regressed)) {
    alerts.push({
      severity: errorRate >= 0.1 ? "error" : "warning",
      message: `${recentErrors} of ${recentResolved} assessed attempts failed or are overdue in the last 24 hours (${(errorRate * 100).toFixed(1)}%).${regressed ? ` This is above the preceding seven days (${(baselineRate * 100).toFixed(1)}%).` : ""}`,
    });
  }

  if (recent.precheckP90Ms !== null && recent.precheckP90Ms > SLOW_PRECHECK_MS) {
    alerts.push({
      severity: "warning",
      message: `Precheck p90 is ${(recent.precheckP90Ms / 1000).toFixed(1)} seconds across ${recent.precheckSamples} measured prechecks; investigate the 90-second deadline.`,
    });
  }
  if (recent.precheckTimeouts > 0) {
    alerts.push({
      severity: "warning",
      message: `${recent.precheckTimeouts} precheck${recent.precheckTimeouts === 1 ? "" : "s"} timed out and failed open in the last 24 hours. Writing may have continued.`,
    });
  }
  if (recent.unknown > 0 || health.baseline.unknown > 0) {
    alerts.push({
      severity: "warning",
      message: `${recent.unknown} recent and ${health.baseline.unknown} baseline attempts have unknown outcomes; completion percentages exclude them.`,
    });
  }
  if (health.capacityIssue === "legacy_reserve") {
    alerts.push({ severity: "error", message: "The database still uses the old submission reserve. Updated workers cannot pass their capacity check until submission-queue migration 100 is applied." });
  } else if (health.capacity === null) {
    alerts.push({ severity: "warning", message: "Submission capacity is unavailable; inactivity cannot be explained from this data." });
  }
  return alerts;
}
