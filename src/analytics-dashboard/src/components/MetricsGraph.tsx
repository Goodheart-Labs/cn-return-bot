import { useEffect, useMemo, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
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
} from "../lib/queries";
import { ToggleGroup } from "./ToggleGroup";

/** A metric is either a plain count per bucket, or a count of people who did
 *  the thing at least n times, where n comes from the slider. The label of a
 *  people metric stops before "at least", because the title renders the
 *  threshold after it as a control. A count with `byBrowser` is drawn as one
 *  line for all browsers and one line per browser. */
type Metric =
  | { kind: "count"; key: CountMetricKey; label: string; qualifier?: string; byBrowser?: BrowserSplitKey }
  | { kind: "people"; key: HistogramMetricKey; label: string };

const METRICS: readonly Metric[] = [
  {
    kind: "count",
    key: "active_devices",
    label: "Number of browsers with the extension open",
    qualifier: "our own test installs left out from version 0.4.1 on",
  },
  {
    kind: "count",
    key: "installs",
    label: "Number of new extension installs",
    qualifier: "our own test installs left out from version 0.4.1 on",
    byBrowser: "installs_by_browser",
  },
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

const GRANULARITIES: readonly { value: Granularity; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const CHART_HEIGHT = 280;
const MARGIN = { top: 16, right: 16, bottom: 36, left: 48 };
/** Points get a dot while there are few enough of them to tell apart. */
const MAX_POINTS_WITH_DOTS = 90;
const LINE_COLOR = "#2563eb";
const TOTAL_COLOR = "#111827";
const AXIS_COLOR = "#d1d5db";
const LABEL_COLOR = "#6b7280";

/** The browsers a split metric draws, each in its own fixed colour. The
 *  colours passed the dataviz skill's palette check against the white
 *  background. Edge and other Chromium browsers run the Chrome build. */
const BROWSER_LINES = [
  { browser: "chrome", label: "Chrome", color: LINE_COLOR },
  { browser: "firefox", label: "Firefox", color: "#eb6834" },
  { browser: "safari", label: "Safari", color: "#1baf7a" },
] as const;

interface Point {
  date: Date;
  value: number | null;
}

/** One line of the graph. Every line has a point for every bucket. */
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
  if (granularity === "week") return `week of ${isoDay(date)}`;
  return isoDay(date);
}

const tickFormat = (granularity: Granularity) => (value: Date | { valueOf(): number }) => {
  const date = value instanceof Date ? value : new Date(value.valueOf());
  return granularity === "month" ? date.toISOString().slice(0, 7) : date.toISOString().slice(5, 10);
};

const bisectDate = bisector<Point, Date>((p) => p.date).center;

/** Counts print whole; a ratio of two metrics prints with two decimals. */
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
  const hovered = tooltipData === undefined ? null : tooltipData;

  const defined = (p: Point) => p.value !== null;
  const showDots = points.length <= MAX_POINTS_WITH_DOTS;

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={CHART_HEIGHT} style={{ display: "block" }}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={innerWidth} stroke={AXIS_COLOR} strokeOpacity={0.5} numTicks={4} />
          <AxisLeft
            scale={yScale}
            numTicks={4}
            stroke={AXIS_COLOR}
            tickStroke={AXIS_COLOR}
            tickFormat={(v) => formatValue(Number(v))}
            tickLabelProps={() => ({ fill: LABEL_COLOR, fontSize: 11, textAnchor: "end", dx: -4, dy: 4 })}
          />
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            numTicks={Math.max(2, Math.floor(innerWidth / 90))}
            stroke={AXIS_COLOR}
            tickStroke={AXIS_COLOR}
            tickFormat={tickFormat(granularity)}
            tickLabelProps={() => ({ fill: LABEL_COLOR, fontSize: 11, textAnchor: "middle", dy: 4 })}
          />
          {hovered !== null && (
            <line
              x1={xScale(points[hovered]!.date)}
              x2={xScale(points[hovered]!.date)}
              y1={0}
              y2={innerHeight}
              stroke={AXIS_COLOR}
            />
          )}
          {/* The first line is the total, so it is drawn last and stays on top
              where the browsers sit on the same values, mostly at zero. */}
          {[...series].reverse().map((s) => (
            <Group key={s.label}>
              <LinePath
                data={s.points}
                defined={defined}
                x={(p) => xScale(p.date)}
                y={(p) => yScale(p.value ?? 0)}
                stroke={s.color}
                strokeWidth={2}
              />
              {showDots &&
                s.points.filter(defined).map((p) => (
                  <circle key={p.date.toISOString()} cx={xScale(p.date)} cy={yScale(p.value ?? 0)} r={3} fill={s.color} />
                ))}
              {hovered !== null && s.points[hovered]?.value != null && (
                <circle
                  cx={xScale(s.points[hovered]!.date)}
                  cy={yScale(s.points[hovered]!.value!)}
                  r={5}
                  fill="#fff"
                  stroke={s.color}
                  strokeWidth={2}
                />
              )}
            </Group>
          ))}
          <rect width={innerWidth} height={innerHeight} fill="transparent" onMouseMove={onMove} onMouseLeave={hideTooltip} />
        </Group>
      </svg>
      {hovered !== null && (
        <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={{ position: "absolute", fontSize: 12, padding: "4px 8px", background: "#111827", color: "#fff", borderRadius: 4, pointerEvents: "none" }}>
          {series.length === 1 ? (
            <>
              {bucketLabel(points[hovered]!.date, granularity)}: {formatValue(series[0]!.points[hovered]!.value ?? 0)}
            </>
          ) : (
            <>
              <div style={{ marginBottom: 2 }}>{bucketLabel(points[hovered]!.date, granularity)}</div>
              {series.map((s) => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, border: "1px solid #9ca3af" }} />
                  <span style={{ flex: 1 }}>{s.label}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.points[hovered]?.value == null ? "–" : formatValue(s.points[hovered]!.value!)}</span>
                </div>
              ))}
            </>
          )}
        </TooltipWithBounds>
      )}
    </div>
  );
}

/** Names each line next to a swatch of its colour. A single line needs no
 *  legend, because the title names it. */
function Legend({ series }: { series: Series[] }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#111827", marginBottom: 4 }}>
      {series.map((s) => (
        <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, background: s.color, borderRadius: 1 }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** The words a choice shows in the picker: a people metric carries its
 *  current threshold, so the menu and the header read the same way. */
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
function MetricPicker({
  selection,
  allowOne,
  onChange,
}: {
  selection: Selection;
  allowOne: boolean;
  onChange: (selection: Selection) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const metric = metricFor(selection.key);
  const keys: SelectionKey[] = [...(allowOne ? [ONE] : []), ...METRICS.map((m) => m.key)];

  // A click anywhere outside the picker closes the menu, as does Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} style={{ position: "relative", display: "inline-block" }}>
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          border: `1px solid ${open ? LINE_COLOR : AXIS_COLOR}`,
          borderRadius: 8,
          background: "#fff",
          cursor: "pointer",
          fontSize: 15,
          fontWeight: 600,
          userSelect: "none",
        }}
      >
        <span>
          {metric?.kind === "people" ? (
            <>
              {metric.label} at least{" "}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ ...selection, sliderOpen: !selection.sliderOpen });
                }}
                title="Click to change how many times"
                style={{
                  font: "inherit",
                  color: LINE_COLOR,
                  background: selection.sliderOpen ? "#dbeafe" : "none",
                  border: "none",
                  borderBottom: `1px dotted ${LINE_COLOR}`,
                  borderRadius: 3,
                  padding: "0 2px",
                  cursor: "pointer",
                }}
              >
                {timesLabel(selection.times)}
              </button>
            </>
          ) : (
            <>
              {selectionTitle(selection.key, selection.times)}
              {metric?.kind === "count" && metric.qualifier && (
                <span style={{ color: LABEL_COLOR, fontWeight: 400 }}> ({metric.qualifier})</span>
              )}
            </>
          )}
        </span>
        <span aria-hidden style={{ color: LABEL_COLOR, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 10,
            margin: "4px 0 0",
            padding: 4,
            listStyle: "none",
            minWidth: "100%",
            whiteSpace: "nowrap",
            background: "#fff",
            border: `1px solid ${AXIS_COLOR}`,
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
          }}
        >
          {keys.map((key) => (
            <li key={key} role="option" aria-selected={key === selection.key}>
              <button
                onClick={() => {
                  onChange({ ...selection, key, sliderOpen: false });
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  border: "none",
                  borderRadius: 6,
                  background: key === selection.key ? "#eff6ff" : "none",
                  color: "#111827",
                  font: "inherit",
                  fontSize: 14,
                  fontWeight: key === selection.key ? 600 : 400,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                onMouseLeave={(e) => (e.currentTarget.style.background = key === selection.key ? "#eff6ff" : "none")}
              >
                {selectionTitle(key, selection.times)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The slider behind a people metric's "at least n times". */
function TimesSlider({ selection, onChange }: { selection: Selection; onChange: (selection: Selection) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: LABEL_COLOR }}>
      <input
        type="range"
        min={1}
        max={HISTOGRAM_CAP}
        value={selection.times}
        onChange={(e) => onChange({ ...selection, times: Number(e.target.value) })}
        style={{ width: 220 }}
      />
      {HISTOGRAM_CAP} means {HISTOGRAM_CAP} or more times
    </label>
  );
}

/** The Common Notes metrics section: the title is a fraction of two pickers.
 *  The top one picks the metric, the bottom one divides it by another metric
 *  or by 1, and a switch picks the bucket size. The series for each bucket
 *  size is fetched once and kept for the session; the pickers and sliders
 *  recompute the line from the cached rows without another request. */
export function MetricsGraph() {
  const [numerator, setNumerator] = useState<Selection>({ key: DEFAULT_METRIC_KEY, times: 1, sliderOpen: false });
  const [denominator, setDenominator] = useState<Selection>({ key: ONE, times: 1, sliderOpen: false });
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [series, setSeries] = useState<Partial<Record<Granularity, MetricSeriesRow[]>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (series[granularity]) return;
    fetchMetricSeries(granularity)
      .then((rows) => setSeries((cached) => ({ ...cached, [granularity]: rows })))
      .catch((e: Error) => setError(e.message));
  }, [granularity, series]);

  const rows = series[granularity];
  const lines = useMemo(() => seriesFor(rows ?? [], numerator, denominator), [rows, numerator, denominator]);
  const firstRecorded = lines[0]!.points.find((p) => p.value !== null)?.date;
  const showSlider = (selection: Selection) => selection.sliderOpen && metricFor(selection.key)?.kind === "people";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        {/* The fraction: numerator, a bar as wide as the wider picker, denominator. */}
        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <MetricPicker selection={numerator} allowOne={false} onChange={setNumerator} />
          {showSlider(numerator) && <TimesSlider selection={numerator} onChange={setNumerator} />}
          <div style={{ alignSelf: "stretch", borderTop: "2px solid #111827" }} />
          <MetricPicker selection={denominator} allowOne onChange={setDenominator} />
          {showSlider(denominator) && <TimesSlider selection={denominator} onChange={setDenominator} />}
        </div>
        <ToggleGroup options={GRANULARITIES} value={granularity} onChange={setGranularity} />
      </div>

      {error && <p style={{ color: "#b91c1c" }}>Failed to load: {error}</p>}
      {!error && !rows && <p style={{ color: LABEL_COLOR }}>Loading…</p>}
      {rows && rows.length === 0 && <p style={{ color: LABEL_COLOR, fontSize: 13 }}>Nothing recorded yet.</p>}
      {rows && rows.length > 0 && (
        <>
          {lines.length > 1 && <Legend series={lines} />}
          {/* ParentSize positions its child absolutely, so it needs the height set. */}
          <ParentSize debounceTime={50} style={{ height: CHART_HEIGHT }}>
            {({ width }) => width > 0 && <LineChart series={lines} granularity={granularity} width={width} />}
          </ParentSize>
          <p style={{ color: LABEL_COLOR, fontSize: 12, margin: "4px 0 0" }}>
            {firstRecorded ? `Recorded since ${isoDay(firstRecorded)}. Earlier buckets are left blank.` : "Not recorded yet."}
            {" "}Buckets are UTC days{granularity === "week" ? ", weeks start on Monday" : ""}.
          </p>
        </>
      )}
    </div>
  );
}
