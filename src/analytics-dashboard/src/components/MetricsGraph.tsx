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
  type CountMetricKey,
  type Granularity,
  type HistogramMetricKey,
  type MetricSeriesRow,
} from "../lib/queries";
import { ToggleGroup } from "./ToggleGroup";

/** A metric is either a plain count per bucket, or a count of people who did
 *  the thing at least n times, where n comes from the slider. The label of a
 *  people metric stops before "at least", because the title renders the
 *  threshold after it as a control. */
type Metric =
  | { kind: "count"; key: CountMetricKey; label: string; qualifier?: string }
  | { kind: "people"; key: HistogramMetricKey; label: string };

const METRICS: readonly Metric[] = [
  {
    kind: "count",
    key: "active_devices",
    label: "Number of people who have used their browser with the extension",
    qualifier: "browser open with the extension installed",
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
const AXIS_COLOR = "#d1d5db";
const LABEL_COLOR = "#6b7280";

interface Point {
  date: Date;
  value: number | null;
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
function pointValue(row: MetricSeriesRow, numerator: Selection, denominator: Selection): number | null {
  const above = selectionValue(row, numerator);
  const below = selectionValue(row, denominator);
  if (above === null || below === null || below === 0) return null;
  return above / below;
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

/** The line itself, sized to its container. Hover shows the bucket under the
 *  pointer, found by bisecting the points on their date. */
function LineChart({ points, granularity, width }: { points: Point[]; granularity: Granularity; width: number }) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop } = useTooltip<Point>();
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
  const maxValue = Math.max(1, ...points.map((p) => p.value ?? 0));
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, maxValue], range: [innerHeight, 0], nice: true }),
    [maxValue, innerHeight],
  );

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const { x } = localPoint(event) ?? { x: 0 };
    const index = bisectDate(points, xScale.invert(x - MARGIN.left));
    const point = points[index];
    if (!point || point.value === null) return hideTooltip();
    showTooltip({
      tooltipData: point,
      tooltipLeft: MARGIN.left + xScale(point.date),
      tooltipTop: MARGIN.top + yScale(point.value),
    });
  };

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
          <LinePath
            data={points}
            defined={defined}
            x={(p) => xScale(p.date)}
            y={(p) => yScale(p.value ?? 0)}
            stroke={LINE_COLOR}
            strokeWidth={2}
          />
          {showDots &&
            points.filter(defined).map((p) => (
              <circle key={p.date.toISOString()} cx={xScale(p.date)} cy={yScale(p.value ?? 0)} r={3} fill={LINE_COLOR} />
            ))}
          {tooltipData && (
            <circle cx={xScale(tooltipData.date)} cy={yScale(tooltipData.value ?? 0)} r={5} fill="#fff" stroke={LINE_COLOR} strokeWidth={2} />
          )}
          <rect width={innerWidth} height={innerHeight} fill="transparent" onMouseMove={onMove} onMouseLeave={hideTooltip} />
        </Group>
      </svg>
      {tooltipData && (
        <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={{ position: "absolute", fontSize: 12, padding: "4px 8px", background: "#111827", color: "#fff", borderRadius: 4, pointerEvents: "none" }}>
          {bucketLabel(tooltipData.date, granularity)}: {tooltipData.value !== null && formatValue(tooltipData.value)}
        </TooltipWithBounds>
      )}
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
 *  a chevron that opens the list of the seven metrics, plus "1" for the
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
  const points = useMemo(
    () => (rows ?? []).map((row) => ({ date: new Date(row.bucket), value: pointValue(row, numerator, denominator) })),
    [rows, numerator, denominator],
  );
  const firstRecorded = points.find((p) => p.value !== null)?.date;
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
          {/* ParentSize positions its child absolutely, so it needs the height set. */}
          <ParentSize debounceTime={50} style={{ height: CHART_HEIGHT }}>
            {({ width }) => width > 0 && <LineChart points={points} granularity={granularity} width={width} />}
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
