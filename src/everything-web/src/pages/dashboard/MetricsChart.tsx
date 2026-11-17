import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchMetricSeries,
  HISTOGRAM_CAP,
  peopleAtLeast,
  type BrowserSplitKey,
  type CountMetricKey,
  type Granularity,
  type HistogramMetricKey,
  type MetricSeriesRow,
} from "@cn/core/dashboard";
import { queryKeys } from "@cn/features/query/queryKeys";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";
import { ChevronIcon } from "@cn/ui/icons";
import { Menu, MenuItem } from "@cn/ui/Menu";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { Slider } from "@cn/ui/Slider";
import { useDismiss } from "@cn/ui/useDismiss";
import { LoadState } from "./tableParts";
import { isoDay, LineChart, type Series } from "../../components/chart/LineChart";

/** A metric is either a plain count per bucket, or a count of people who did
 *  the thing at least n times, where n comes from the slider. The label of a
 *  people metric stops before "at least", because the title renders the
 *  threshold after it as a control. A count with `byBrowser` is drawn as one
 *  line for all browsers and one line per browser. */
type Metric =
  | { kind: "count"; key: CountMetricKey; label: string; caveat?: string; byBrowser?: BrowserSplitKey }
  | { kind: "people"; key: HistogramMetricKey; label: string };

const OWN_INSTALLS_CAVEAT = "Our own test installs are left out from version 0.4.1 on.";

const METRICS: readonly Metric[] = [
  { kind: "count", key: "active_devices", label: "Number of browsers with the extension open", caveat: OWN_INSTALLS_CAVEAT },
  { kind: "count", key: "installs", label: "Number of new extension installs", caveat: OWN_INSTALLS_CAVEAT, byBrowser: "installs_by_browser" },
  { kind: "people", key: "note_viewers", label: "Number of people who have seen a note" },
  { kind: "people", key: "voters", label: "Number of people who have voted" },
  { kind: "people", key: "writers", label: "Number of people who have written a note" },
  { kind: "count", key: "notes_seen", label: "Number of notes seen" },
  { kind: "count", key: "votes", label: "Number of votes" },
  { kind: "count", key: "notes_written", label: "Number of notes written by humans" },
];

const DEFAULT_METRIC_KEY: Metric["key"] = "note_viewers";

/** The denominator's extra choice: dividing by one plots the metric itself. */
const ONE = "one" as const;
type SelectionKey = Metric["key"] | typeof ONE;

/** What one picker holds: which metric, the "at least n times" threshold for
 *  a people metric, and whether its slider is showing. */
interface Selection {
  key: SelectionKey;
  times: number;
  sliderOpen: boolean;
}

const metricFor = (key: SelectionKey): Metric | null => METRICS.find((m) => m.key === key) ?? null;

const GRANULARITIES: readonly { id: Granularity; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];

/* The chart draws with the design tokens, so dark mode swaps its colours as it
 * swaps the rest of the page. */
const LINE_COLOR = "var(--cn-primary)";
const TOTAL_COLOR = "var(--cn-fg)";

/** The browsers a split metric draws, each in its own fixed colour. Edge and
 *  other Chromium browsers run the Chrome build. */
const BROWSER_LINES = [
  { browser: "chrome", label: "Chrome", color: LINE_COLOR },
  { browser: "firefox", label: "Firefox", color: "var(--cn-caution-solid)" },
  { browser: "safari", label: "Safari", color: "var(--cn-positive-solid)" },
] as const;

/** The value one selection has in one bucket. Null keeps a gap in the line
 *  for buckets before the source began recording. */
function selectionValue(row: MetricSeriesRow, selection: Selection): number | null {
  const metric = metricFor(selection.key);
  if (!metric) return 1;
  if (metric.kind === "count") return row[metric.key];
  return peopleAtLeast(row[metric.key], selection.times);
}

/** The plotted value: the numerator divided by the denominator. A bucket
 *  where either side is not recorded, or the denominator is zero, is a gap. */
function ratio(above: number | null, below: number | null): number | null {
  if (above === null || below === null || below === 0) return null;
  return above / below;
}

/** The lines to draw: one for the numerator, and for a metric split by
 *  browser one more per browser. Each line is divided by the denominator. */
function seriesFor(rows: MetricSeriesRow[], numerator: Selection, denominator: Selection): Series[] {
  const line = (label: string, color: string, above: (row: MetricSeriesRow) => number | null): Series => ({
    label,
    color,
    points: rows.map((row) => ({ date: new Date(row.bucket), value: ratio(above(row), selectionValue(row, denominator)) })),
  });
  const metric = metricFor(numerator.key);
  const splitKey = metric?.kind === "count" ? metric.byBrowser : undefined;
  if (!splitKey) return [line("", LINE_COLOR, (row) => selectionValue(row, numerator))];
  return [
    line("All browsers", TOTAL_COLOR, (row) => selectionValue(row, numerator)),
    ...BROWSER_LINES.map(({ browser, label, color }) =>
      line(label, color, (row) => {
        const split = row[splitKey];
        return split === null ? null : (split[browser] ?? 0);
      }),
    ),
  ];
}

/** The words after "at least" in the title: "once", "2 times", and "20 or
 *  more times" at the cap. */
function timesLabel(times: number): string {
  if (times === 1) return "once";
  if (times >= HISTOGRAM_CAP) return `${HISTOGRAM_CAP} or more times`;
  return `${times} times`;
}

/** The words a choice shows in the menu. A people metric carries its current
 *  threshold, so the menu and the picker read the same way. */
function selectionTitle(key: SelectionKey, times: number): string {
  const metric = metricFor(key);
  if (!metric) return "1";
  return metric.kind === "people" ? `${metric.label} at least ${timesLabel(times)}` : metric.label;
}

/** One line of the fraction, which is also its picker: a framed heading with
 *  a chevron that opens the list of the eight metrics, plus "1" for the
 *  denominator. A people metric renders its threshold as a nested control:
 *  clicking "once" opens the slider that changes n instead of opening the
 *  menu. */
function MetricPicker({ selection, allowOne, onChange }: { selection: Selection; allowOne: boolean; onChange: (selection: Selection) => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(container, open, close);
  const metric = metricFor(selection.key);
  const keys: SelectionKey[] = [...(allowOne ? [ONE] : []), ...METRICS.map((m) => m.key)];

  return (
    <div ref={container} className="relative inline-block">
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((wasOpen) => !wasOpen);
          }
        }}
        className={cn(
          "inline-flex cursor-pointer select-none items-center gap-3 rounded-control border bg-surface px-3 py-2 text-left text-sm font-semibold text-fg hover:bg-surface-hover",
          focusRing,
          open ? "border-primary" : "border-line-strong",
        )}
      >
        <span>
          {metric?.kind === "people" ? (
            <>
              {metric.label} at least{" "}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ ...selection, sliderOpen: !selection.sliderOpen });
                }}
                title="Change how many times"
                className={cn(
                  "rounded-sm border-b border-dotted border-link px-0.5 text-link",
                  focusRing,
                  selection.sliderOpen && "bg-tint",
                )}
              >
                {timesLabel(selection.times)}
              </button>
            </>
          ) : (
            selectionTitle(selection.key, selection.times)
          )}
        </span>
        <ChevronIcon size={16} aria-hidden className={cn("shrink-0 text-fg-muted transition-transform", open ? "-rotate-90" : "rotate-90")} />
      </div>
      {open && (
        <Menu className="absolute left-0 top-full z-10 mt-1 w-max min-w-full max-w-[calc(100vw-2rem)]">
          {keys.map((key) => (
            <MenuItem
              key={key}
              selected={key === selection.key}
              onClick={() => {
                onChange({ ...selection, key, sliderOpen: false });
                close();
              }}
            >
              {selectionTitle(key, selection.times)}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

/** The slider behind a people metric's "at least n times". The site's slider
 *  starts at 0, so it holds n minus one. */
function TimesSlider({ selection, onChange }: { selection: Selection; onChange: (selection: Selection) => void }) {
  return (
    <div className="w-64">
      <Slider
        label="At least"
        value={selection.times - 1}
        max={HISTOGRAM_CAP - 1}
        formatValue={(value) => timesLabel(value + 1)}
        onChange={(value) => onChange({ ...selection, times: value + 1 })}
      />
    </div>
  );
}

/** The caption under the chart: since when the metric is recorded, what a
 *  bucket is, and any caveat of the chosen metrics. */
function Caption({ series, granularity, caveats }: { series: Series[]; granularity: Granularity; caveats: string[] }) {
  const firstRecorded = series[0]!.points.find((p) => p.value !== null)?.date;
  return (
    <p className="mt-1 text-xs text-fg-muted">
      {firstRecorded ? `Recorded since ${isoDay(firstRecorded)}. Earlier buckets are left blank.` : "Not recorded yet."} Buckets are UTC days
      {granularity === "week" ? ", and weeks start on Monday" : ""}. {caveats.join(" ")}
    </p>
  );
}

/** The metrics section: the title is a fraction of two pickers. The top one
 *  picks the metric, the bottom one divides it by another metric or by 1, and
 *  a switch picks the bucket size. The series for each bucket size is fetched
 *  once and kept in the query cache. The pickers and sliders recompute the
 *  lines from the cached rows without another request. */
export function MetricsChart() {
  const [numerator, setNumerator] = useState<Selection>({ key: DEFAULT_METRIC_KEY, times: 1, sliderOpen: false });
  const [denominator, setDenominator] = useState<Selection>({ key: ONE, times: 1, sliderOpen: false });
  const [granularity, setGranularity] = useState<Granularity>("day");
  const query = useQuery({ queryKey: queryKeys.dashboardMetricSeries(granularity), queryFn: () => fetchMetricSeries(granularity) });

  const rows = query.data;
  const lines = useMemo(() => seriesFor(rows ?? [], numerator, denominator), [rows, numerator, denominator]);
  const showSlider = (selection: Selection) => selection.sliderOpen && metricFor(selection.key)?.kind === "people";
  const caveats = [...new Set([numerator, denominator].map((s) => metricFor(s.key)).flatMap((m) => (m?.kind === "count" && m.caveat ? [m.caveat] : [])))];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        {/* The fraction: numerator, a bar as wide as the wider picker, denominator. */}
        <div className="inline-flex flex-col items-center gap-1.5">
          <MetricPicker selection={numerator} allowOne={false} onChange={setNumerator} />
          {showSlider(numerator) && <TimesSlider selection={numerator} onChange={setNumerator} />}
          <div className="self-stretch border-t-2 border-fg" />
          <MetricPicker selection={denominator} allowOne onChange={setDenominator} />
          {showSlider(denominator) && <TimesSlider selection={denominator} onChange={setDenominator} />}
        </div>
        <SegmentedControl label="Bucket size" options={GRANULARITIES} value={granularity} onChange={setGranularity} />
      </div>

      {!rows && <LoadState error={query.error} onRetry={() => void query.refetch()} />}
      {rows?.length === 0 && <p className="text-sm text-fg-muted">Nothing recorded yet.</p>}
      {rows && rows.length > 0 && (
        <>
          <LineChart series={lines} granularity={granularity} />
          <Caption series={lines} granularity={granularity} caveats={caveats} />
        </>
      )}
    </div>
  );
}
