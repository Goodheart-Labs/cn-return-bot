import { useMemo, useRef } from "react";
import { Brush, type BaseBrushState, type Bounds, type BrushProps } from "@visx/brush";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { Bar } from "@visx/shape";
import type { PipelineDayRow } from "../lib/queries";

/** A window over the daily rows: the first day inside it and the first day
 *  after it, as indexes into the array. So [start, end) in days, and the
 *  boundaries are always 00:00 UTC. */
export interface DayWindow {
  start: number;
  end: number;
}

const STRIP_HEIGHT = 64;
const HANDLE_WIDTH = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const BAR_COLOR = "#9ca3af";
const SELECTION_STYLE = { fill: "#2563eb", fillOpacity: 0.15, stroke: "#2563eb", strokeWidth: 1, strokeOpacity: 0.8 };

/** The brush instance behind the ref. The package exports the class only
 *  through the prop that receives it. */
type BrushInstance = NonNullable<NonNullable<BrushProps["innerRef"]>["current"]>;

const dayDate = (row: PipelineDayRow) => new Date(row.day);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The strip with the draggable selection. It draws one faint bar per day for
 *  the posts finished that day, so the busy stretches show through, and lets
 *  the reader resize the selection at either end or drag it whole. When a
 *  drag ends, the selection snaps to day boundaries and the window reports
 *  them. */
function Strip({ days, window, onChange, width }: { days: PipelineDayRow[]; window: DayWindow; onChange: (w: DayWindow) => void; width: number }) {
  const brushRef = useRef<BrushInstance | null>(null);
  const firstDay = dayDate(days[0]!).getTime();
  const dayAfterLast = dayDate(days[days.length - 1]!).getTime() + DAY_MS;

  const xScale = useMemo(
    () => scaleTime<number>({ domain: [new Date(firstDay), new Date(dayAfterLast)], range: [0, width] }),
    [firstDay, dayAfterLast, width],
  );
  const maxItems = Math.max(1, ...days.map((d) => d.items_processed));
  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, maxItems], range: [STRIP_HEIGHT, 0] }), [maxItems]);

  const dayIndexAt = (ms: number) => clamp(Math.round((ms - firstDay) / DAY_MS), 0, days.length);

  /** The brush reports its bounds in data values: for a time scale they are
   *  dates, typed as numbers. Snap them to whole days, keep at least one day,
   *  and move the selection onto the snapped boundaries. */
  const onBrushEnd = (bounds: Bounds | null) => {
    if (!bounds) return;
    const start = dayIndexAt(Number(bounds.x0));
    const end = Math.max(start + 1, dayIndexAt(Number(bounds.x1)));
    const snapped = { start: Math.min(start, days.length - 1), end: Math.min(end, days.length) };
    onChange(snapped);
    brushRef.current?.updateBrush((prev: BaseBrushState) => {
      const startPoint = { x: xScale(new Date(firstDay + snapped.start * DAY_MS)), y: prev.start.y };
      const endPoint = { x: xScale(new Date(firstDay + snapped.end * DAY_MS)), y: prev.end.y };
      const extent = brushRef.current!.getExtent(startPoint, endPoint);
      return { ...prev, start: startPoint, end: endPoint, extent };
    });
  };

  // The brush reads its initial position once, when it mounts. It is keyed on
  // the width below, so a resize remounts it at the current window.
  const initialBrushPosition = {
    start: { x: xScale(new Date(firstDay + window.start * DAY_MS)) },
    end: { x: xScale(new Date(firstDay + window.end * DAY_MS)) },
  };

  return (
    <svg width={width} height={STRIP_HEIGHT} style={{ display: "block" }}>
      <Group>
        {days.map((day) => {
          const x = xScale(dayDate(day));
          const barWidth = Math.max(0.5, xScale(new Date(dayDate(day).getTime() + DAY_MS)) - x - 0.5);
          const y = yScale(day.items_processed);
          return <Bar key={day.day} x={x} y={y} width={barWidth} height={STRIP_HEIGHT - y} fill={BAR_COLOR} />;
        })}
        <Brush
          key={width}
          innerRef={brushRef}
          xScale={xScale}
          yScale={yScale}
          width={width}
          height={STRIP_HEIGHT}
          handleSize={HANDLE_WIDTH}
          resizeTriggerAreas={["left", "right"]}
          brushDirection="horizontal"
          initialBrushPosition={initialBrushPosition}
          onBrushEnd={onBrushEnd}
          selectedBoxStyle={SELECTION_STYLE}
          disableDraggingSelection={false}
          useWindowMoveEvents
        />
      </Group>
    </svg>
  );
}

/** The window's dates, e.g. "2026-08-11 to 2026-09-10 (30 days)". The end day
 *  named is the last day inside the window, because "to 2026-09-10 00:00"
 *  reads as if the 10th were excluded. */
function windowLabel(days: PipelineDayRow[], window: DayWindow): string {
  const lastInside = days[window.end - 1]!.day;
  const count = window.end - window.start;
  return `${days[window.start]!.day} to ${lastInside} (${count} ${count === 1 ? "day" : "days"})`;
}

export function TimeWindow({ days, window, onChange }: { days: PipelineDayRow[]; window: DayWindow; onChange: (w: DayWindow) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{windowLabel(days, window)}</span>
        <span style={{ color: "#6b7280" }}>Drag the ends to resize, the middle to move. Bars show posts finished per day.</span>
      </div>
      <ParentSize debounceTime={50}>{({ width }) => width > 0 && <Strip days={days} window={window} onChange={onChange} width={width} />}</ParentSize>
    </div>
  );
}
