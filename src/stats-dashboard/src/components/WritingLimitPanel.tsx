import type { WritingLimitMetrics } from "../lib/writingLimit";
import { formatPercent, formatSignedPercent } from "../lib/format";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-base font-medium text-gray-900">{value}</div>
      {hint && <div className="text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

export function WritingLimitPanel({ metrics }: { metrics: WritingLimitMetrics }) {
  const hp = metrics.highPerformingXxl
    ? "XXL (≥100 impact / 90d)"
    : metrics.highPerformingLargeXl
      ? "Large / XL"
      : "No (below threshold)";

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <h3 className="text-sm font-medium text-gray-800 mb-3">Writing-limit metrics (selected notes)</h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
        <Stat label="Daily writing limit" value={`${metrics.WL}`} hint={metrics.wlReason} />
        <Stat label="High-performing" value={hp} hint={`Notes ≥100? ${metrics.T >= 100 ? "✓" : "✗"} · CRNH-rate ≤10%? ${metrics.crnhRate100 != null && metrics.crnhRate100 <= 0.10 ? "✓" : "✗"}`} />
        <Stat label="Total notes (T)" value={`${metrics.T}`} />
        <Stat label="DN_30" value={metrics.DN_30.toFixed(2)} hint="avg notes/day, last 30d" />
        <Stat label="Impact (90d)" value={`${metrics.impact90d}`} hint="#CRH − #CRNH" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
        <Stat label="HR_R" value={formatSignedPercent(metrics.HR_R)} hint="last 20 notes" />
        <Stat label="HR_100" value={formatSignedPercent(metrics.HR_100)} hint="last 100 notes" />
        <Stat
          label="HR_14d"
          value={metrics.HR_14d == null ? "n/a" : formatSignedPercent(metrics.HR_14d)}
          hint={metrics.HR_14d == null ? "no rating data in last 14d" : "qualifying notes only"}
        />
        <Stat label="HR_L" value={formatSignedPercent(metrics.HR_L)} hint="max(HR_100, HR_14d)" />
        <Stat label="WL_L (internal)" value={metrics.WL_L == null ? "n/a" : metrics.WL_L.toFixed(1)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="NH_5" value={`${metrics.NH_5}`} hint="CRNH in last 5 non-NMR" />
        <Stat label="NH_10" value={`${metrics.NH_10}`} hint="CRNH in last 10 non-NMR" />
        <Stat
          label="CRNH-rate (last 100)"
          value={metrics.crnhRate100 == null ? "n/a" : formatPercent(metrics.crnhRate100)}
        />
      </div>
    </div>
  );
}
