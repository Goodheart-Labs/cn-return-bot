import type { HeadlineMetrics } from "../lib/aggregations";
import { formatCount, formatUsd, formatUsdMicro, formatViews } from "../lib/format";

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex-1 min-w-[180px]">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

export function MetricsHeader({ metrics }: { metrics: HeadlineMetrics }) {
  return (
    <div className="flex flex-wrap gap-3">
      <MetricCard label="Helpful notes" value={formatCount(metrics.helpfulNotes)} />
      <MetricCard label="Views on our notes" value={formatViews(metrics.totalViews)} />
      <MetricCard
        label="Cost per helpful note"
        value={metrics.costPerHelpfulNote == null ? "—" : formatUsd(metrics.costPerHelpfulNote)}
      />
      <MetricCard
        label="Cost per view (helpful)"
        value={metrics.costPerViewOnHelpful == null ? "—" : formatUsdMicro(metrics.costPerViewOnHelpful)}
      />
    </div>
  );
}
