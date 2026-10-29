import { useEffect, useRef } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { useParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { AXIS_COLOR, tickLabel, tooltipClass } from "./chartTheme";

/* A bar per day or week, each made of stacked parts. Two layouts:
 *   counts   the `up` parts stack above a zero line and the `down` parts hang
 *            below it, such as helpful notes above and unhelpful ones below.
 *   shares   every bar is 100% tall and its parts are shares of it.
 * When there are more bars than fit, the chart scrolls sideways and starts at
 * the newest bar on the right. */

export interface BarPart {
  key: string;
  label: string;
  color: string;
}

export interface Bar {
  key: string;
  label: string;
  values: Record<string, number>;
}

const CHART_HEIGHT = 300;
const MARGIN = { top: 10, right: 8, bottom: 28, left: 44 };
const MAX_VISIBLE_BARS = 28;
const BAR_PADDING = 0.2;
const VALUE_TICKS = 5;
/** The room one bar label needs, such as "Wk of Oct 27". */
const LABEL_SPACING = 90;
/** Room at both ends of the bars, so the first and last label are not cut:
 *  half of LABEL_SPACING. */
const EDGE = 45;

const sum = (bar: Bar, parts: readonly BarPart[]) => parts.reduce((total, part) => total + (bar.values[part.key] ?? 0), 0);
/** A share in percent. Shares under 10% keep a decimal, so a small part does
 *  not read as 0%. */
const percentText = (fraction: number) => `${(fraction * 100).toFixed(fraction > 0 && fraction < 0.1 ? 1 : 0)}%`;

export function StackedBarChart(props: { bars: Bar[]; up: readonly BarPart[]; down?: readonly BarPart[]; shares?: boolean; emptyText: string }) {
  // The hook measures the width only, so the chart sets its own height. The
  // ParentSize component would wrap it in a box of no height.
  const { parentRef, width } = useParentSize({ debounceTime: 50 });
  if (props.bars.length === 0) return <p className="py-16 text-center text-sm text-fg-muted">{props.emptyText}</p>;
  return <div ref={parentRef}>{width > 0 && <Chart {...props} width={width} />}</div>;
}

function Chart({ bars, up, down = [], shares = false, width }: { bars: Bar[]; up: readonly BarPart[]; down?: readonly BarPart[]; shares?: boolean; width: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop } = useTooltip<Bar>();
  const visibleBars = Math.min(bars.length, MAX_VISIBLE_BARS);
  const viewWidth = width - MARGIN.left - MARGIN.right - 2 * EDGE;
  const slot = viewWidth / visibleBars;
  const innerWidth = slot * bars.length;
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

  // The newest bar is on the right, so the chart starts scrolled to the end.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [bars.length, width]);

  const x = scaleBand<string>({ domain: bars.map((b) => b.key), range: [0, innerWidth], padding: BAR_PADDING });
  const maxUp = shares ? 1 : Math.max(1, ...bars.map((b) => sum(b, up)));
  const maxDown = shares ? 0 : Math.max(0, ...bars.map((b) => sum(b, down)));
  const y = scaleLinear<number>({ domain: [-maxDown, maxUp], range: [innerHeight, 0], nice: !shares });
  const labelEvery = Math.max(1, Math.ceil(visibleBars / Math.max(1, Math.floor(viewWidth / LABEL_SPACING))));

  /** The parts of a bar as rectangles, from the zero line outwards. */
  const rects = (bar: Bar) => {
    const total = sum(bar, up);
    let above = 0;
    let below = 0;
    const scale = (value: number) => (shares ? (total === 0 ? 0 : value / total) : value);
    return [
      ...up.map((part) => {
        const value = scale(bar.values[part.key] ?? 0);
        const rect = { part, y0: above, y1: above + value };
        above += value;
        return rect;
      }),
      ...down.map((part) => {
        const value = bar.values[part.key] ?? 0;
        const rect = { part, y0: -below - value, y1: -below };
        below += value;
        return rect;
      }),
    ];
  };

  return (
    <div className="relative">
      <div ref={scroller} className="overflow-x-auto" style={{ marginLeft: MARGIN.left }}>
        <div className="relative" style={{ width: innerWidth + 2 * EDGE + MARGIN.right }}>
          <svg width={innerWidth + 2 * EDGE + MARGIN.right} height={CHART_HEIGHT} className="block">
            <Group top={MARGIN.top} left={EDGE}>
              <GridRows scale={y} left={-EDGE} width={innerWidth + 2 * EDGE} stroke={AXIS_COLOR} strokeOpacity={0.5} numTicks={VALUE_TICKS} />
              {bars.map((bar) => (
                <Group
                  key={bar.key}
                  left={x(bar.key)}
                  onMouseEnter={() => showTooltip({ tooltipData: bar, tooltipLeft: EDGE + (x(bar.key) ?? 0) + x.bandwidth() / 2, tooltipTop: MARGIN.top + y(shares ? 1 : sum(bar, up)) })}
                  onMouseLeave={hideTooltip}
                >
                  {/* A full-height target, so the pointer finds short bars too. */}
                  <rect width={x.bandwidth()} height={innerHeight} fill="transparent" />
                  {rects(bar).map(({ part, y0, y1 }) =>
                    y1 > y0 ? <rect key={part.key} width={x.bandwidth()} y={y(y1)} height={y(y0) - y(y1)} fill={part.color} /> : null,
                  )}
                </Group>
              ))}
              {!shares && <line x1={0} x2={innerWidth} y1={y(0)} y2={y(0)} stroke={AXIS_COLOR} />}
              <AxisBottom
                top={innerHeight}
                scale={x}
                stroke={AXIS_COLOR}
                tickStroke={AXIS_COLOR}
                tickValues={bars.filter((_, i) => (bars.length - 1 - i) % labelEvery === 0).map((b) => b.key)}
                tickFormat={(key) => bars.find((b) => b.key === key)?.label ?? ""}
                tickLabelProps={() => ({ ...tickLabel, textAnchor: "middle", dy: 4 })}
              />
            </Group>
          </svg>
          {tooltipData && (
            <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={{ position: "absolute", pointerEvents: "none" }} className={tooltipClass}>
              <BarTooltip bar={tooltipData} parts={[...up, ...down]} shares={shares} total={sum(tooltipData, up)} />
            </TooltipWithBounds>
          )}
        </div>
      </div>
      {/* The value axis stays put while the bars scroll beside it. */}
      <svg width={MARGIN.left} height={CHART_HEIGHT} className="pointer-events-none absolute left-0 top-0">
        <AxisLeft
          left={MARGIN.left}
          top={MARGIN.top}
          scale={y}
          numTicks={VALUE_TICKS}
          stroke={AXIS_COLOR}
          tickStroke={AXIS_COLOR}
          tickFormat={(v) => (shares ? percentText(Number(v)) : Number(v).toLocaleString("en-US"))}
          tickLabelProps={() => ({ ...tickLabel, textAnchor: "end", dx: -4, dy: 4 })}
        />
      </svg>
    </div>
  );
}

function BarTooltip({ bar, parts, shares, total }: { bar: Bar; parts: readonly BarPart[]; shares: boolean; total: number }) {
  return (
    <>
      <div className="mb-0.5 font-semibold">{bar.label}</div>
      {parts.map((part) => {
        const value = bar.values[part.key] ?? 0;
        return (
          <div key={part.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: part.color }} />
            <span className="flex-1">{part.label}</span>
            <span className="tabular-nums">
              {value.toLocaleString("en-US")}
              {shares && total > 0 && ` (${percentText(value / total)})`}
            </span>
          </div>
        );
      })}
    </>
  );
}
