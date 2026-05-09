import type { HeadlineMetrics } from "../lib/aggregations";
import { formatCount, formatUsd, formatUsdMicro, formatViews } from "../lib/format";

function MetricCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex-1 min-w-[180px]">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
      {sublabel && <div className="text-xs text-gray-400 mt-1">{sublabel}</div>}
    </div>
  );
}

export function MetricsHeader({ metrics }: { metrics: HeadlineMetrics }) {
  return (
    <div className="flex flex-wrap gap-3">
      <MetricCard
        label="Helpful notes"
        value={formatCount(metrics.helpfulNotes)}
        sublabel={`of ${formatCount(metrics.totalNotes)} submitted`}
      />
      <MetricCard
        label="Views on our notes"
        value={formatViews(metrics.totalViews)}
        sublabel={`${formatViews(metrics.viewsOnHelpful)} on helpful notes`}
      />
      <MetricCard
        label="Cost per helpful note"
        value={metrics.costPerHelpfulNote == null ? "—" : formatUsd(metrics.costPerHelpfulNote)}
        sublabel={metrics.totalCost == null ? "no cost data in selection" : `total LLM spend ${formatUsd(metrics.totalCost)}`}
      />
      <MetricCard
        label="Cost per view (helpful)"
        value={metrics.costPerViewOnHelpful == null ? "—" : formatUsdMicro(metrics.costPerViewOnHelpful)}
        sublabel="LLM spend ÷ views on helpful notes"
      />
    </div>
  );
}
