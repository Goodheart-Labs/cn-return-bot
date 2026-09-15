import type { HeadlineMetrics } from "../lib/aggregations";
import type { NoteRecord } from "../lib/types";
import { formatCount, formatUsd, formatUsdMicro, formatViews } from "../lib/format";

export function PublicMetrics({ notes }: { notes: NoteRecord[] }) {
  const measured = notes.filter((note) => note.view_count !== null);
  const views = measured.reduce((sum, note) => sum + note.view_count!, 0);
  return (
    <section aria-label="Public impact" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <div className="text-sm text-gray-600">Views on these high-impact notes</div>
          <div className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900">{measured.length ? formatViews(views) : "—"}</div>
          <div className="mt-2 text-xs text-gray-500">Cumulative views · recorded for {formatCount(measured.length)} of {formatCount(notes.length)} selected notes</div>
        </div>
        <div>
          <div className="text-sm text-gray-600">Share of all Community Notes views</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-gray-500">Not available</div>
          <div className="mt-2 text-xs text-gray-500">We need a comparable total of Community Notes views across X to calculate this percentage.</div>
        </div>
      </div>
    </section>
  );
}

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
