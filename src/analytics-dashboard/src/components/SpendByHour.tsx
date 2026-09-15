import { useEffect, useMemo, useState } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { Bar, Line } from "@visx/shape";
import { Text } from "@visx/text";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { fetchSpendByHour, type SpendHourRow } from "../lib/queries";

/** How many days the chart shows. A paced day reads as a low flat row and
 *  the old pattern as one tall bar after midnight; a week is enough to tell
 *  the two apart. */
const WINDOW_DAYS = 7;

const CHART_HEIGHT = 260;
const MARGIN = { top: 30, right: 16, bottom: 36, left: 48 };
const HOUR_MS = 3600_000;
const BAR_COLOR = "#2563eb";
const AXIS_COLOR = "#d1d5db";
const DAY_LINE_COLOR = "#9ca3af";
const LABEL_COLOR = "#6b7280";
const TOTAL_COLOR = "#111827";

interface HourPoint {
  hour: Date;
  cost: number;
  runs: number;
}

interface DayTotal {
  start: Date;
  cost: number;
}

const money = (usd: number) => `$${usd.toFixed(2)}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayLabel = (d: Date) => d.toISOString().slice(5, 10);
const hourLabel = (d: Date) => `${dayLabel(d)} ${d.toISOString().slice(11, 16)} UTC`;

/** The total printed above each UTC day of the window. */
function dayTotals(points: HourPoint[]): DayTotal[] {
  const byDay = new Map<string, DayTotal>();
  for (const p of points) {
    const key = isoDay(p.hour);
    const day = byDay.get(key) ?? { start: new Date(key), cost: 0 };
    day.cost += p.cost;
    byDay.set(key, day);
  }
  return [...byDay.values()];
}

/** One bar per UTC hour, with a line and a total at every day boundary.
 *  Hover shows the hour under the pointer. */
function HourBars({ points, width }: { points: HourPoint[]; width: number }) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop } = useTooltip<HourPoint>();
  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const firstHour = points[0]!.hour;
  const endOfWindow = new Date(points[points.length - 1]!.hour.getTime() + HOUR_MS);

  const xScale = useMemo(
    () => scaleTime<number>({ domain: [firstHour, endOfWindow], range: [0, innerWidth] }),
    [firstHour, endOfWindow, innerWidth],
  );
  const maxCost = Math.max(1, ...points.map((p) => p.cost));
  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, maxCost], range: [innerHeight, 0], nice: true }), [maxCost, innerHeight]);
  const hourWidth = innerWidth / points.length;
  const barWidth = Math.max(1, hourWidth - 1);
  const days = dayTotals(points);
  const dayWidth = xScale(new Date(firstHour.getTime() + 24 * HOUR_MS)) - xScale(firstHour);

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const { x } = localPoint(event) ?? { x: 0 };
    const index = Math.floor((xScale.invert(x - MARGIN.left).getTime() - firstHour.getTime()) / HOUR_MS);
    const point = points[index];
    if (!point) return hideTooltip();
    showTooltip({
      tooltipData: point,
      tooltipLeft: MARGIN.left + xScale(point.hour) + barWidth / 2,
      tooltipTop: MARGIN.top + yScale(point.cost),
    });
  };

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
            tickFormat={(v) => `$${Number(v)}`}
            tickLabelProps={() => ({ fill: LABEL_COLOR, fontSize: 11, textAnchor: "end", dx: -4, dy: 4 })}
          />
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            tickValues={days.map((d) => d.start)}
            stroke={AXIS_COLOR}
            tickStroke={AXIS_COLOR}
            tickFormat={(v) => dayLabel(v instanceof Date ? v : new Date(v.valueOf()))}
            tickLabelProps={() => ({ fill: LABEL_COLOR, fontSize: 11, textAnchor: "start", dx: 3, dy: 4 })}
          />
          {days.map((day) => (
            <Group key={isoDay(day.start)}>
              <Line from={{ x: xScale(day.start), y: 0 }} to={{ x: xScale(day.start), y: innerHeight }} stroke={DAY_LINE_COLOR} strokeDasharray="2,3" />
              <Text x={xScale(day.start) + dayWidth / 2} y={-10} textAnchor="middle" fontSize={12} fontWeight={600} fill={TOTAL_COLOR}>
                {money(day.cost)}
              </Text>
            </Group>
          ))}
          {points.map((p) =>
            p.cost > 0 ? (
              <Bar key={p.hour.toISOString()} x={xScale(p.hour)} y={yScale(p.cost)} width={barWidth} height={innerHeight - yScale(p.cost)} fill={BAR_COLOR} />
            ) : null,
          )}
          {tooltipData && (
            <Bar x={xScale(tooltipData.hour)} y={0} width={barWidth} height={innerHeight} fill={BAR_COLOR} fillOpacity={0.12} />
          )}
          <rect width={innerWidth} height={innerHeight} fill="transparent" onMouseMove={onMove} onMouseLeave={hideTooltip} />
        </Group>
      </svg>
      {tooltipData && (
        <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={{ position: "absolute", fontSize: 12, padding: "4px 8px", background: "#111827", color: "#fff", borderRadius: 4, pointerEvents: "none" }}>
          {hourLabel(tooltipData.hour)}: {money(tooltipData.cost)}, {tooltipData.runs} pipeline step{tooltipData.runs === 1 ? "" : "s"}
        </TooltipWithBounds>
      )}
    </div>
  );
}

/** The last week of Common Notes spend, one bar per UTC hour, so a day paced
 *  across its hours and a day spent in a burst after midnight look different
 *  at a glance. */
export function SpendByHour() {
  const [rows, setRows] = useState<SpendHourRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSpendByHour(WINDOW_DAYS)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const points = useMemo(
    () => rows?.map((r) => ({ hour: new Date(r.hour), cost: Number(r.cost), runs: Number(r.runs) })) ?? null,
    [rows],
  );

  if (error) return <p style={{ color: "#b91c1c" }}>Failed to load: {error}</p>;
  if (!points) return <p style={{ color: "#6b7280" }}>Loading…</p>;
  if (points.length === 0) return <p style={{ color: "#6b7280", fontSize: 13 }}>Nothing was spent in the last {WINDOW_DAYS} days.</p>;

  return (
    <div>
      <ParentSize debounceTime={50} style={{ height: CHART_HEIGHT }}>
        {({ width }) => width > 0 && <HourBars points={points} width={width} />}
      </ParentSize>
      <p style={{ color: LABEL_COLOR, fontSize: 12, margin: "8px 0 0" }}>
        Every LLM cost the Common Notes pipeline recorded in the last {WINDOW_DAYS} days, by the UTC hour it was recorded. The number above each day is that day's total. Pages readers requested are included.
      </p>
    </div>
  );
}
