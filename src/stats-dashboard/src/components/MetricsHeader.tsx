import type { HeadlineMetrics, HelpfulNoteShare } from "../lib/aggregations";
import { formatCount, formatPercent, formatUsd, formatUsdMicro, formatViews } from "../lib/format";

export function PublicMetrics({ metrics, noteShare }: { metrics: HeadlineMetrics; noteShare: HelpfulNoteShare | null }) {
  const date = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  return (
    <section aria-label="Public impact" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className={`grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-6 ${noteShare ? "sm:grid-cols-3" : ""}`}>
        <div className={noteShare ? "col-span-2 sm:col-span-1" : ""}>
          <div className="text-sm text-gray-600">Views on our Helpful notes</div>
          <div className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900">{metrics.helpfulNotesWithViews > 0 ? formatViews(metrics.viewsOnHelpful) : "—"}</div>
          <div className="mt-2 text-xs text-gray-500">Cumulative views · recorded for {formatCount(metrics.helpfulNotesWithViews)} of {formatCount(metrics.helpfulNotes)} notes</div>
        </div>
        <div>
          <div className="text-sm text-gray-600">Our notes rated Helpful</div>
          <div className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900">{formatCount(metrics.helpfulNotes)}</div>
          <div className="mt-2 text-xs text-gray-500">Currently rated Helpful by contributors</div>
        </div>
        {noteShare && (
          <div>
            <div className="text-sm text-gray-600">Our share of Helpful notes</div>
            <div className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-blue-700">{formatPercent(noteShare.proportion)}</div>
            <div className="mt-2 text-xs text-gray-500">{formatCount(noteShare.ours)} of {formatCount(noteShare.total)} notes · by note count</div>
          </div>
        )}
      </div>
      {noteShare && (
        <p className="mt-5 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-500">
          The share compares notes written {date(noteShare.firstDay)}–{date(noteShare.lastDay)} that are currently rated Helpful, using{' '}
          <a href="https://communitynotes.x.com/guide/en/under-the-hood/download-data" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">X’s public Community Notes data</a>.
        </p>
      )}
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
