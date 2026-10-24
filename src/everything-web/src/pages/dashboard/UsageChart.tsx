import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleUtc } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { bisector } from "d3-array";
import { fetchClaudeUsage, type ClaudeUsageRow } from "@cn/core/dashboard";
import { queryKeys } from "@cn/features/query/queryKeys";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { LoadState } from "./tableParts";

type RangeId = "7" | "30";

const RANGES: readonly { id: RangeId; label: string; days: number }[] = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
];

/** Above this share of the weekly limit the runner on ai-box starts no new
 *  post (MAX_WEEKLY_USAGE_PERCENT in src/claude-notes/runner.ts). */
const RUNNER_STOPS_AT_PERCENT = 90;
const FULL_PERCENT = 100;
const DAY_MS = 24 * 3600_000;

const CHART_HEIGHT = 260;
const MARGIN = { top: 16, right: 16, bottom: 36, left: 44 };
const PIXELS_PER_TIME_TICK = 90;
const VALUE_TICKS = 5;
const TICK_FONT_SIZE = 11;

const LINE_COLOR = "var(--cn-primary)";
const LIMIT_COLOR = "var(--cn-caution-solid)";
const AXIS_COLOR = "var(--cn-line-strong)";
const LABEL_COLOR = "var(--cn-fg-muted)";
const SURFACE_COLOR = "var(--cn-surface)";

type Point = { date: Date; weekly: number };

const bisectDate = bisector<Point, Date>((p) => p.date).center;

/** A tick at midnight names the day, and any other tick its hour, so a range
 *  with several ticks a day does not repeat the date. All in UTC. */
const timeTick = (date: Date) => (date.getUTCHours() === 0 ? date.toISOString().slice(5, 10) : `${date.toISOString().slice(11, 13)}:00`);

const formatTime = (date: Date) =>
  date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }) + " UTC";

function UsageLines({ points, width }: { points: Point[]; width: number }) {
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop } = useTooltip<Point>();
  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = useMemo(
    () => scaleUtc<number>({ domain: [points[0]!.date, points[points.length - 1]!.date], range: [0, innerWidth] }),
    [points, innerWidth],
  );
  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, FULL_PERCENT], range: [innerHeight, 0] }), [innerHeight]);
  const tickLabel = { fill: LABEL_COLOR, fontSize: TICK_FONT_SIZE };

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const { x } = localPoint(event) ?? { x: 0 };
    const point = points[bisectDate(points, xScale.invert(x - MARGIN.left))]!;
    showTooltip({ tooltipData: point, tooltipLeft: MARGIN.left + xScale(point.date), tooltipTop: MARGIN.top + yScale(point.weekly) });
  };

  return (
    <div className="relative">
      <svg width={width} height={CHART_HEIGHT} className="block">
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={innerWidth} stroke={AXIS_COLOR} strokeOpacity={0.5} numTicks={VALUE_TICKS} />
          <line
            x1={0}
            x2={innerWidth}
            y1={yScale(RUNNER_STOPS_AT_PERCENT)}
            y2={yScale(RUNNER_STOPS_AT_PERCENT)}
            stroke={LIMIT_COLOR}
            strokeDasharray="5 4"
          />
          <text x={innerWidth} y={yScale(RUNNER_STOPS_AT_PERCENT) - 4} textAnchor="end" fill={LIMIT_COLOR} fontSize={TICK_FONT_SIZE}>
            New posts stop here
          </text>
          <AxisLeft
            scale={yScale}
            numTicks={VALUE_TICKS}
            stroke={AXIS_COLOR}
            tickStroke={AXIS_COLOR}
            tickFormat={(v) => `${Number(v)}%`}
            tickLabelProps={() => ({ ...tickLabel, textAnchor: "end", dx: -4, dy: 4 })}
          />
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            numTicks={Math.max(2, Math.floor(innerWidth / PIXELS_PER_TIME_TICK))}
            stroke={AXIS_COLOR}
            tickStroke={AXIS_COLOR}
            tickFormat={(value) => timeTick(value instanceof Date ? value : new Date(value.valueOf()))}
            tickLabelProps={() => ({ ...tickLabel, textAnchor: "middle", dy: 4 })}
          />
          <LinePath data={points} x={(p) => xScale(p.date)} y={(p) => yScale(p.weekly)} stroke={LINE_COLOR} strokeWidth={2} />
          {tooltipData && <circle cx={xScale(tooltipData.date)} cy={yScale(tooltipData.weekly)} r={4} fill={LINE_COLOR} stroke={SURFACE_COLOR} strokeWidth={2} />}
          <rect width={innerWidth} height={innerHeight} fill="transparent" onMouseMove={onMove} onMouseLeave={hideTooltip} />
        </Group>
      </svg>
      {tooltipData && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={{ position: "absolute", pointerEvents: "none" }}
          className="rounded-control bg-inverse px-2 py-1 text-xs text-on-inverse shadow-floating"
        >
          <div className="font-semibold">{tooltipData.weekly}% of the week</div>
          <div>{formatTime(tooltipData.date)}</div>
        </TooltipWithBounds>
      )}
    </div>
  );
}

const toPoints = (rows: ClaudeUsageRow[]): Point[] => rows.map((row) => ({ date: new Date(row.at), weekly: row.weekly }));

/** How much of the weekly limit the Claude note writer's plan has used, read
 *  every 5 minutes by the runner on Nathan's ai-box. The line climbs during
 *  the week and drops when the limit resets. */
export function UsageChart() {
  const [rangeId, setRangeId] = useState<RangeId>("7");
  const days = RANGES.find((r) => r.id === rangeId)!.days;
  const query = useQuery({
    queryKey: queryKeys.dashboardClaudeUsage(days),
    queryFn: () => fetchClaudeUsage(new Date(Date.now() - days * DAY_MS).toISOString()),
  });
  const points = useMemo(() => toPoints(query.data ?? []), [query.data]);
  const latest = query.data?.[query.data.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-secondary">
          {latest
            ? `${latest.weekly}% of Nathan's weekly limit used${latest.weekly_resets_at ? `. It resets ${formatTime(new Date(latest.weekly_resets_at))}` : ""}.`
            : "Share of Nathan's weekly Claude limit the note writer runs on."}
        </p>
        <SegmentedControl label="Time range" options={RANGES} value={rangeId} onChange={setRangeId} />
      </div>
      {!query.data ? (
        <LoadState error={query.error} onRetry={() => void query.refetch()} />
      ) : points.length < 2 ? (
        <p className="text-sm text-fg-muted">Not enough readings yet. The runner stores one every 5 minutes.</p>
      ) : (
        // ParentSize positions its child absolutely, so it needs the height set.
        <ParentSize debounceTime={50} style={{ height: CHART_HEIGHT }}>
          {({ width }) => width > 0 && <UsageLines points={points} width={width} />}
        </ParentSize>
      )}
    </div>
  );
}
