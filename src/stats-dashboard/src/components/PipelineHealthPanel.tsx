import { useCallback, useEffect, useRef, useState } from "react";
import { healthAlerts, type HealthCapacity, type HealthPeriod, type PipelineHealth } from "../lib/health";
import { formatCount, formatPercent } from "../lib/format";

const REPOSITORY = "https://github.com/Goodheart-Labs/cn-return-bot";
const count = (value: number) => formatCount(value);
const daily = (value: number) => (value / 7).toLocaleString("en-US", { maximumFractionDigits: 1 });
const duration = (ms: number | null) => ms === null ? "Not measured" : `${(ms / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}s`;
const timestamp = (value: string) => new Date(value).toLocaleString();
const code = (value: string | null) => value === null ? "Not recorded" : /^[a-z][a-z0-9_/-]{0,79}$/i.test(value) ? value.replaceAll("_", " ") : "Other";

function age(value: string, now: number): string {
  const seconds = Math.floor((now - Date.parse(value)) / 1000);
  if (seconds < -60) return "Timestamp is ahead of this device";
  if (seconds < 60) return "less than a minute ago";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const dateValue = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalDate = (value: unknown) => value === null || dateValue(value);
const optionalString = (value: unknown) => value === null || typeof value === "string";

function validPeriod(value: unknown): value is HealthPeriod {
  if (!record(value)) return false;
  const counts = ["attempts", "completed", "failed", "overdue", "active", "unknown", "submitted", "candidates", "rejected", "filtered", "precheckSamples", "precheckTimeouts"];
  return counts.every((key) => nonnegative(value[key]) && Number.isInteger(value[key]))
    && (value.completionRate === null || nonnegative(value.completionRate) && value.completionRate <= 1)
    && [value.precheckMedianMs, value.precheckP90Ms].every((ms) => ms === null || nonnegative(ms));
}

function validHealth(value: unknown): value is PipelineHealth {
  if (!record(value) || !dateValue(value.generated_at) || (value.mode !== "live" && value.mode !== "snapshot")) return false;
  if (!validPeriod(value.recent) || !validPeriod(value.baseline) || !nonnegative(value.overdueTotal)
    || !optionalDate(value.latestAttemptAt) || !optionalDate(value.latestSubmissionAt)) return false;
  if (value.capacity !== null) {
    const capacity = value.capacity;
    if (!record(capacity) || typeof capacity.canSubmit !== "boolean" || typeof capacity.probe !== "boolean"
      || ![capacity.signalQueued, capacity.inFlight, capacity.used24h].every(nonnegative)
      || !optionalDate(capacity.nextAttemptAt)) return false;
  }
  return Array.isArray(value.reasons) && value.reasons.every((row) => record(row)
    && typeof row.outcome === "string" && typeof row.reason === "string" && nonnegative(row.count))
    && Array.isArray(value.examples) && value.examples.every((run) => record(run)
      && typeof run.id === "string" && optionalString(run.tweet_id) && dateValue(run.created_at)
      && [run.outcome, run.outcome_reason, run.final_stage, run.commit_sha].every(optionalString));
}

function Completion({ period, baseline = false }: { period: HealthPeriod; baseline?: boolean }) {
  const assessed = period.completed + period.failed + period.overdue;
  return (
    <>
      <div className="font-semibold text-gray-900">{period.completionRate === null ? "No assessed attempts" : formatPercent(period.completionRate)}</div>
      <div className="mt-1 text-xs text-gray-500">{count(period.completed)} / {count(assessed)} assessed attempts</div>
      <div className="mt-1 text-xs text-gray-600">
        {baseline ? `${daily(period.failed)} errors + ${daily(period.overdue)} overdue per day` : `${count(period.failed)} errors + ${count(period.overdue)} overdue`}
      </div>
      <div className="mt-1 text-xs text-gray-500">{count(period.active)} active · {count(period.unknown)} unclassified in period</div>
    </>
  );
}

function Precheck({ period }: { period: HealthPeriod }) {
  return (
    <>
      <div className="font-medium text-gray-900">Median {duration(period.precheckMedianMs)} · p90 {duration(period.precheckP90Ms)}</div>
      <div className="mt-1 text-xs text-gray-500">{count(period.precheckSamples)} measured · {count(period.precheckTimeouts)} timeouts in period</div>
    </>
  );
}

function Capacity({ capacity }: { capacity: HealthCapacity | null }) {
  if (!capacity) return <p className="text-sm text-amber-800">Submission capacity unavailable.</p>;
  const status = !capacity.canSubmit
    ? capacity.probe && capacity.inFlight > 0 ? "Waiting for in-flight claims" : "Submission admission is blocked"
    : capacity.signalQueued > 0 ? "Signal queue has priority"
      : capacity.probe ? "One probe attempt is permitted" : "Automatic submission is permitted";
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-gray-900">{status}</p>
      {!capacity.canSubmit && capacity.nextAttemptAt && (
        <p className="text-gray-600">Next retry check: <time dateTime={capacity.nextAttemptAt}>{timestamp(capacity.nextAttemptAt)}</time></p>
      )}
      {!capacity.canSubmit && capacity.signalQueued > 0 && <p className="text-gray-600">Queued Signal notes have priority when admission opens.</p>}
      <p className="text-gray-600">{count(capacity.signalQueued)} Signal queued · {count(capacity.inFlight)} in flight · {count(capacity.used24h)} submitted in 24h</p>
      <p className="text-xs text-gray-500">Account-wide admission at collection, including Signal. X decides whether an attempt succeeds.</p>
    </div>
  );
}

export function PipelineHealthPanel() {
  const [health, setHealth] = useState<PipelineHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setRefreshing(true);
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}pipeline-health.json`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? "Pipeline health data is unavailable (404)." : `Pipeline health refresh failed (HTTP ${response.status}).`);
      const data: unknown = await response.json().catch(() => null);
      if (!validHealth(data)) throw new Error("Pipeline health data is unavailable or has an invalid format.");
      if (mounted.current && !controller.signal.aborted) {
        setHealth(data);
        setError(null);
        setNow(Date.now());
      }
    } catch (failure) {
      if (mounted.current && activeRequest.current === controller) {
        const message = controller.signal.aborted ? "Pipeline health refresh timed out."
          : failure instanceof Error && failure.message.startsWith("Pipeline health ") ? failure.message : "Pipeline health refresh failed. Check the connection and retry.";
        setError(message);
      }
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (mounted.current) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const refreshTimer = window.setInterval(() => { void refresh(); }, 60_000);
    const ageTimer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
      activeRequest.current = null;
      window.clearInterval(refreshTimer);
      window.clearInterval(ageTimer);
    };
  }, [refresh]);

  const alerts = health ? healthAlerts(health, now) : [];
  return (
    <section aria-label="Pipeline health" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Pipeline health</h2>
          {health && <p className="mt-1 text-xs text-gray-500">
            {health.mode === "live" ? "Live data" : "Snapshot"} · Collected <time dateTime={health.generated_at}>{timestamp(health.generated_at)}</time> · {age(health.generated_at, now)}
          </p>}
          <p className="mt-1 text-xs text-gray-500">Checks for updates every minute. {health?.mode === "snapshot" && "Published snapshots refresh every 4 hours. "}This measures automatic per-tweet attempts, not scheduled job status.</p>
        </div>
        <button type="button" onClick={() => { void refresh(); }} disabled={refreshing}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {error} {health ? "Showing the last collected data below." : "No health assessment is available."}
      </p>}
      {!health && !error && <p role="status" className="text-sm text-gray-500">Loading pipeline health… No health assessment is available yet.</p>}

      {health && <>
        {alerts.length > 0 ? (
          <ul className="space-y-2" aria-label="Health alerts">
            {alerts.map((alert, index) => <li key={index} className={`rounded-md border p-3 text-sm ${alert.severity === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              {alert.message}
            </li>)}
          </ul>
        ) : <p className="text-sm text-gray-600">No alerts in the collected attempt data.</p>}

        {health.recent.attempts + health.baseline.attempts === 0 && <p className="text-sm text-amber-800">No automatic tweet attempts were recorded in either period. This does not establish whether scheduled jobs ran.</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Automatic tweet attempts: last 24 hours versus the preceding seven days</caption>
            <thead><tr className="border-b border-gray-200 text-gray-600">
              <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
              <th scope="col" className="py-2 pr-4 font-medium">Last 24 hours</th>
              <th scope="col" className="py-2 font-medium">Preceding 7 days</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <th scope="row" className="py-3 pr-4 align-top font-medium text-gray-700">Technical completion</th>
                <td className="py-3 pr-4 align-top"><Completion period={health.recent} /></td>
                <td className="py-3 align-top"><Completion period={health.baseline} baseline /></td>
              </tr>
              <tr>
                <th scope="row" className="py-3 pr-4 align-top font-medium text-gray-700">Attempt volume</th>
                <td className="py-3 pr-4 align-top font-semibold text-gray-900">{count(health.recent.attempts)} / day</td>
                <td className="py-3 align-top"><span className="font-semibold text-gray-900">{daily(health.baseline.attempts)} / day</span><div className="mt-1 text-xs text-gray-500">{count(health.baseline.attempts)} across 7 days</div></td>
              </tr>
              <tr>
                <th scope="row" className="py-3 pr-4 align-top font-medium text-gray-700">Note-needed precheck</th>
                <td className="py-3 pr-4 align-top"><Precheck period={health.recent} /></td>
                <td className="py-3 align-top text-xs text-gray-500">Timing is collected for the last 24 hours.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-gray-500">
          Normal no-note decisions count as technical completion. Active and unclassified attempts are excluded from that rate.
          Previous-period volumes, errors and overdue counts are divided by 7; completion rates use the full period.
          A precheck timeout that lets processing continue is counted separately from technical failure. p90 means 90% of measured prechecks finished within that time.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Latest activity</h3>
            <dl className="space-y-2 text-sm">
              {[{ label: "Automatic attempt", at: health.latestAttemptAt }, { label: "Account submission (including Signal)", at: health.latestSubmissionAt }].map(({ label, at }) => (
                <div key={label}><dt className="text-gray-500">{label}</dt><dd className="mt-1 text-gray-900">{at ? <><time dateTime={at}>{timestamp(at)}</time><span className="text-gray-500"> · {age(at, now)}</span></> : "Not recorded"}</dd></div>
              ))}
            </dl>
            <p className="text-xs text-gray-500">{count(health.overdueTotal)} overdue in total, including older attempts.</p>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Submission admission</h3>
            <Capacity capacity={health.capacity} />
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Outcomes and reasons · last 24 hours</h3>
          {health.reasons.length === 0 ? <p className="text-sm text-gray-500">No outcome counts recorded.</p> : <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-gray-200 text-gray-600"><th scope="col" className="py-2 pr-3 font-medium">Outcome</th><th scope="col" className="py-2 pr-3 font-medium">Reason</th><th scope="col" className="py-2 text-right font-medium">Attempts</th></tr></thead>
              <tbody className="divide-y divide-gray-100">{health.reasons.map((row, index) => <tr key={index}><td className="py-2 pr-3 break-words">{code(row.outcome)}</td><td className="py-2 pr-3 break-words">{code(row.reason)}</td><td className="py-2 text-right tabular-nums">{count(row.count)}</td></tr>)}</tbody>
            </table>
          </div>}
        </div>

        <details className="border-t border-gray-100 pt-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Attempt examples · last 24 hours ({health.examples.length})</summary>
          {health.examples.length === 0 ? <p className="mt-3 text-sm text-gray-500">No examples recorded.</p> : <ul className="mt-3 divide-y divide-gray-100">
            {health.examples.map((run) => <li key={run.id} className="space-y-1 py-3 text-sm break-words">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {run.tweet_id && /^\d+$/.test(run.tweet_id) ? <a href={`https://x.com/i/status/${run.tweet_id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Post {run.tweet_id} ↗</a> : <span className="text-gray-500">Post unavailable</span>}
                {run.commit_sha && /^[a-f0-9]{7,40}$/i.test(run.commit_sha) && <a href={`${REPOSITORY}/commit/${run.commit_sha}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Commit {run.commit_sha.slice(0, 7)} ↗</a>}
                <time dateTime={run.created_at} className="text-gray-500">{timestamp(run.created_at)}</time>
              </div>
              <p className="text-gray-700">{code(run.outcome)} · {code(run.outcome_reason)} · Stage: {code(run.final_stage)}</p>
            </li>)}
          </ul>}
        </details>
      </>}
    </section>
  );
}
