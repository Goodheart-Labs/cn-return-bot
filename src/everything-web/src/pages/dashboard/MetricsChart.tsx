import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { bisector } from "d3-array";
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
import { useOutsidePress } from "@cn/ui/useOutsidePress";
import { LoadState } from "./tableParts";
import { AXIS_COLOR, SURFACE_COLOR, tickLabel, tooltipClass } from "../../components/chart/chartTheme";

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

const CHART_HEIGHT = 300;
const MARGIN = { top: 16, right: 16, bottom: 36, left: 48 };
/** Points get a dot while there are few enough of them to tell apart. */
const MAX_POINTS_WITH_DOTS = 90;
/** Room for one tick label on the time axis. */
const PIXELS_PER_TIME_TICK = 90;
const VALUE_TICKS = 4;

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

interface Point {
  date: Date;
  value: number | null;
}

/** One line of the chart. Every line has a point for every bucket. */
interface Series {
  label: string;
  color: string;
  points: Point[];
}

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

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function bucketLabel(date: Date, granularity: Granularity): string {
  if (granularity === "month") return date.toISOString().slice(0, 7);
  if (granularity === "week") return `Week of ${isoDay(date)}`;
  return isoDay(date);
}

const tickFormat = (granularity: Granularity) => (value: Date | { valueOf(): number }) => {
  const date = value instanceof Date ? value : new Date(value.valueOf());
  return granularity === "month" ? date.toISOString().slice(0, 7) : date.toISOString().slice(5, 10);
};

const bisectDate = bisector<Point, Date>((p) => p.date).center;

/** Counts print whole. A ratio of two metrics prints with two decimals. */
const formatValue = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The lines themselves, sized to their container. Hover shows the bucket
 *  under the pointer, found by bisecting the points on their date, with the
 *  value of every line in it. */
function LineChart({ series, granularity, width }: { series: Series[]; granularity: Granularity; width: number }) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop } = useTooltip<number>();
  const points = series[0]!.points;
  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(
    () =>
      scaleTime<number>({
        domain: [points[0]?.date ?? new Date(), points[points.length - 1]?.date ?? new Date()],
        range: [0, innerWidth],
      }),
    [points, innerWidth],
  );
  const maxValue = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value ?? 0)));
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, maxValue], range: [innerHeight, 0], nice: true }),
    [maxValue, innerHeight],
  );

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const { x } = localPoint(event) ?? { x: 0 };
    const index = bisectDate(points, xScale.invert(x - MARGIN.left));
    const values = series.map((s) => s.points[index]?.value ?? null);
    if (values.every((v) => v === null)) return hideTooltip();
    showTooltip({
      tooltipData: index,
      tooltipLeft: MARGIN.left + xScale(points[index]!.date),
      tooltipTop: MARGIN.top + yScale(Math.max(...values.map((v) => v ?? 0))),
    });
  };
  const hovered = tooltipData ?? null;

  const defined = (p: Point) => p.value !== null;
  const showDots = points.length <= MAX_POINTS_WITH_DOTS;

  return (
    <div className="relative">
      <svg width={width} height={CHART_HEIGHT} className="block">
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={innerWidth} stroke={AXIS_COLOR} strokeOpacity={0.5} numTicks={VALUE_TICKS} />
          <AxisLeft
            scale={yScale}
            numTicks={VALUE_TICKS}
            stroke={AXIS_COLOR}
            tickStroke={AXIS_COLOR}
            tickFormat={(v) => formatValue(Number(v))}
            tickLabelProps={() => ({ ...tickLabel, textAnchor: "end", dx: -4, dy: 4 })}
          />
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            numTicks={Math.max(2, Math.floor(innerWidth / PIXELS_PER_TIME_TICK))}
            stroke={AXIS_COLOR}
            tickStroke={AXIS_COLOR}
            tickFormat={tickFormat(granularity)}
            tickLabelProps={() => ({ ...tickLabel, textAnchor: "middle", dy: 4 })}
          />
          {hovered !== null && (
            <line x1={xScale(points[hovered]!.date)} x2={xScale(points[hovered]!.date)} y1={0} y2={innerHeight} stroke={AXIS_COLOR} />
          )}
          {/* The first line is the total, so it is drawn last and stays on top
              where the browsers sit on the same values, mostly at zero. */}
          {series.toReversed().map((s) => (
            <Group key={s.label}>
              <LinePath data={s.points} defined={defined} x={(p) => xScale(p.date)} y={(p) => yScale(p.value ?? 0)} stroke={s.color} strokeWidth={2} />
              {showDots &&
                s.points.filter(defined).map((p) => <circle key={p.date.toISOString()} cx={xScale(p.date)} cy={yScale(p.value ?? 0)} r={3} fill={s.color} />)}
              {hovered !== null && s.points[hovered]?.value != null && (
                <circle cx={xScale(s.points[hovered]!.date)} cy={yScale(s.points[hovered]!.value!)} r={5} fill={SURFACE_COLOR} stroke={s.color} strokeWidth={2} />
              )}
            </Group>
          ))}
          <rect width={innerWidth} height={innerHeight} fill="transparent" onMouseMove={onMove} onMouseLeave={hideTooltip} />
        </Group>
      </svg>
      {hovered !== null && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={{ position: "absolute", pointerEvents: "none" }}
          className={tooltipClass}
        >
          <div className={cn(series.length > 1 && "mb-0.5")}>
            {bucketLabel(points[hovered]!.date, granularity)}
            {series.length === 1 && `: ${formatValue(series[0]!.points[hovered]!.value ?? 0)}`}
          </div>
          {series.length > 1 &&
            series.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                <span className="flex-1">{s.label}</span>
                <span className="tabular-nums">{s.points[hovered]?.value == null ? "–" : formatValue(s.points[hovered]!.value!)}</span>
              </div>
            ))}
        </TooltipWithBounds>
      )}
    </div>
  );
}

/** Names each line next to a swatch of its colour. A single line needs no
 *  legend, because the title names it. */
function Legend({ series }: { series: Series[] }) {
  return (
    <div className="mb-1 flex flex-wrap gap-4 text-xs text-fg-secondary">
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** The words a choice shows in the menu. A people metric carries its current
 *  threshold, so the menu and the picker read the same way. */
function selectionTitle(key: SelectionKey, times: number): string {
  const metric = metricFor(key);
  if (!metric) return "1";
  return metric.kind === "people" ? `${metric.label} at least ${timesLabel(times)}` : metric.label;
}

/** Closes an open menu on Escape, as the site's other popovers do. */
function useCloseOnEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);
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
  useOutsidePress(container, open, close);
  useCloseOnEscape(open, close);
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
          {lines.length > 1 && <Legend series={lines} />}
          {/* ParentSize positions its child absolutely, so it needs the height set. */}
          <ParentSize debounceTime={50} style={{ height: CHART_HEIGHT }}>
            {({ width }) => width > 0 && <LineChart series={lines} granularity={granularity} width={width} />}
          </ParentSize>
          <Caption series={lines} granularity={granularity} caveats={caveats} />
        </>
      )}
    </div>
  );
}
