import { useMemo } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { bisector } from "d3-array";
import type { Granularity } from "@cn/core/dashboard";
import { cn } from "@cn/ui/cn";
import { AXIS_COLOR, SURFACE_COLOR, tickLabel, tooltipClass } from "./chartTheme";

export interface Point {
  date: Date;
  value: number | null;
}

/** One line of the chart. Every line has a point for every bucket, and a
 *  null value leaves a gap. */
export interface Series {
  label: string;
  color: string;
  points: Point[];
}

const CHART_HEIGHT = 300;
const MARGIN = { top: 16, right: 16, bottom: 36, left: 48 };
/** Points get a dot while there are few enough of them to tell apart. */
const MAX_POINTS_WITH_DOTS = 90;
/** Room for one tick label on the time axis. */
const PIXELS_PER_TIME_TICK = 90;
const VALUE_TICKS = 4;

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

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
const formatNumber = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

interface LineChartProps {
  series: Series[];
  granularity: Granularity;
  /** How the value axis and the tooltip print a value. */
  formatValue?: (value: number) => string;
}

/** The lines themselves, sized to their container. Hover shows the bucket
 *  under the pointer, found by bisecting the points on their date, with the
 *  value of every line in it. */
function Lines({ series, granularity, formatValue = formatNumber, width }: LineChartProps & { width: number }) {
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
              where the parts sit on the same values, mostly at zero. */}
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

/** A line chart over time, as wide as its container. The first series is
 *  the total and is drawn on top. A chart of several lines shows a legend
 *  above it. */
export function LineChart(props: LineChartProps) {
  return (
    <>
      {props.series.length > 1 && <LineLegend series={props.series} />}
      {/* ParentSize positions its child absolutely, so it needs the height set. */}
      <ParentSize debounceTime={50} style={{ height: CHART_HEIGHT }}>
        {({ width }) => width > 0 && <Lines {...props} width={width} />}
      </ParentSize>
    </>
  );
}

/** Names each line next to a swatch of its colour. A single line needs no
 *  legend, because the title names it. */
function LineLegend({ series }: { series: Series[] }) {
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
