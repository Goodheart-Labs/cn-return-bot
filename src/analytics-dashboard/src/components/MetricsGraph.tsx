import { useEffect, useMemo, useState } from "react";
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

/** The value the selected metric has in one bucket. Null keeps a gap in the
 *  line for buckets before the source began recording. */
function pointValue(row: MetricSeriesRow, metric: Metric, times: number): number | null {
  if (metric.kind === "count") return row[metric.key];
  return peopleAtLeast(row[metric.key], times);
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
            tickFormat={(v) => Number(v).toLocaleString()}
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
          {bucketLabel(tooltipData.date, granularity)}: {tooltipData.value?.toLocaleString()}
        </TooltipWithBounds>
      )}
    </div>
  );
}

/** The title of the plot. A people metric carries the "at least n times"
 *  control after its label: the threshold reads as a link, and clicking it
 *  opens the slider that changes n. */
function PlotTitle({ metric, times, sliderOpen, onToggleSlider }: { metric: Metric; times: number; sliderOpen: boolean; onToggleSlider: () => void }) {
  if (metric.kind === "count") {
    return (
      <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>
        {metric.label}
        {metric.qualifier && <span style={{ color: LABEL_COLOR, fontWeight: 400 }}> ({metric.qualifier})</span>}
      </h3>
    );
  }
  return (
    <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>
      {metric.label} at least{" "}
      <button
        onClick={onToggleSlider}
        title="Click to change how many times"
        style={{
          font: "inherit",
          fontWeight: 600,
          color: LINE_COLOR,
          background: sliderOpen ? "#dbeafe" : "none",
          border: "none",
          borderBottom: `1px dotted ${LINE_COLOR}`,
          borderRadius: 3,
          padding: "0 2px",
          cursor: "pointer",
        }}
      >
        {timesLabel(times)}
      </button>
    </h3>
  );
}

/** The Common Notes metrics section: pick one of seven metrics, pick the
 *  bucket size, and read the line. The series for each bucket size is fetched
 *  once and kept for the session, and the slider recomputes the line from the
 *  cached rows without another request. */
export function MetricsGraph() {
  const [metricKey, setMetricKey] = useState<Metric["key"]>(DEFAULT_METRIC_KEY);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [times, setTimes] = useState(1);
  const [sliderOpen, setSliderOpen] = useState(false);
  const [series, setSeries] = useState<Partial<Record<Granularity, MetricSeriesRow[]>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (series[granularity]) return;
    fetchMetricSeries(granularity)
      .then((rows) => setSeries((cached) => ({ ...cached, [granularity]: rows })))
      .catch((e: Error) => setError(e.message));
  }, [granularity, series]);

  const metric = METRICS.find((m) => m.key === metricKey)!;
  const rows = series[granularity];
  const points = useMemo(
    () => (rows ?? []).map((row) => ({ date: new Date(row.bucket), value: pointValue(row, metric, times) })),
    [rows, metric, times],
  );
  const firstRecorded = points.find((p) => p.value !== null)?.date;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetricKey(m.key)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid #d1d5db",
              background: m.key === metricKey ? "#111827" : "#fff",
              color: m.key === metricKey ? "#fff" : "#111827",
              cursor: "pointer",
              fontSize: 13,
              textAlign: "left",
            }}
          >
            {m.kind === "people" ? `${m.label} at least once` : m.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ flex: "1 1 320px" }}>
          <PlotTitle metric={metric} times={times} sliderOpen={sliderOpen} onToggleSlider={() => setSliderOpen((open) => !open)} />
          {metric.kind === "people" && sliderOpen && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: LABEL_COLOR }}>
              <input type="range" min={1} max={HISTOGRAM_CAP} value={times} onChange={(e) => setTimes(Number(e.target.value))} style={{ width: 220 }} />
              {HISTOGRAM_CAP} means {HISTOGRAM_CAP} or more times
            </label>
          )}
        </div>
        <ToggleGroup options={GRANULARITIES} value={granularity} onChange={setGranularity} />
      </div>

      {error && <p style={{ color: "#b91c1c" }}>Failed to load: {error}</p>}
      {!error && !rows && <p style={{ color: LABEL_COLOR }}>Loading…</p>}
      {rows && rows.length === 0 && <p style={{ color: LABEL_COLOR, fontSize: 13 }}>Nothing recorded yet.</p>}
      {rows && rows.length > 0 && (
        <>
          <ParentSize debounceTime={50}>{({ width }) => <LineChart points={points} granularity={granularity} width={width} />}</ParentSize>
          <p style={{ color: LABEL_COLOR, fontSize: 12, margin: "4px 0 0" }}>
            {firstRecorded ? `Recorded since ${isoDay(firstRecorded)}. Earlier buckets are left blank.` : "Not recorded yet."}
            {" "}Buckets are UTC days{granularity === "week" ? ", weeks start on Monday" : ""}.
          </p>
        </>
      )}
    </div>
  );
}
