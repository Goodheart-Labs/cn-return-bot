import { useEffect, useRef, useState } from "react";
import type { ChartBucket, ShareBucket } from "../lib/aggregations";
import type { ChartGranularity, ChartMode } from "../lib/types";

const CHART_HEIGHT = 320;
const PAD_TOP = 12;
const PAD_BOTTOM = 50;
const PAD_LEFT = 50;
const PAD_RIGHT = 12;
const BAR_GAP_FRAC = 0.2;
const MAX_VISIBLE_BARS = 28;

const COLOR_HELPFUL = "#10b981";
const COLOR_UNHELPFUL = "#ef4444";
const COLOR_NMR = "#9ca3af";
const COLOR_NON_CANDIDATE = "#111827";
// The "% of all" chart gives each origin its own blue. Our notes get the
// strongest one, other AI notes a medium one, and human notes the lightest.
const COLOR_OURS = "#2563eb";
const COLOR_OTHER_AI = "#60a5fa";
const COLOR_HUMAN = "#bfdbfe";
const COLOR_AXIS = "#d1d5db";
const COLOR_LABEL = "#6b7280";

interface BarChartProps {
  buckets: ChartBucket[];
  shareBuckets: ShareBucket[];
  granularity: ChartGranularity;
  mode: ChartMode;
  width: number;
  showNonCandidate: boolean;
  showNmr: boolean;
}

function niceStep(rough: number): number {
  // Integer-only steps for count axes.
  if (rough <= 1) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const norm = rough / base;
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  return nice * base;
}

function niceTicks(maxValue: number, count = 4): number[] {
  if (maxValue <= 0) return [0];
  const step = niceStep(maxValue / count);
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + step / 2; v += step) ticks.push(v);
  return ticks;
}

// Decide how many bars to skip between x-axis labels, so that the user always
// sees roughly TARGET_LABELS_IN_VIEW of them. The spacing is measured against
// the smaller of the whole dataset and the visible window. A dataset that fits
// on screen therefore gets about seven labels in total. A longer dataset that
// has to be scrolled gets about seven labels in every window of
// MAX_VISIBLE_BARS bars.
const TARGET_LABELS_IN_VIEW = 7;
function tickLabelEvery(numBars: number): number {
  const effectiveBars = Math.min(numBars, MAX_VISIBLE_BARS);
  return Math.max(1, Math.ceil(effectiveBars / TARGET_LABELS_IN_VIEW));
}

// ─── The 100%-stacked model, used by the ratio mode and the share mode ───────

interface StackSegment {
  key: string;
  color: string;
  label: string;
  value: number;
}
interface StackBucket {
  key: string;
  label: string;
  segments: StackSegment[];
}

function stackTotal(b: StackBucket): number {
  return b.segments.reduce((sum, seg) => sum + seg.value, 0);
}

// In ratio mode each bar is split into helpful notes, not-helpful notes, and
// notes that need more ratings. Non-candidate runs are a fourth segment, shown
// only while their toggle is on. When it is off that segment is left out
// altogether, so the remaining three add up to 100%.
function ratioToStacks(buckets: ChartBucket[], showNonCandidate: boolean): StackBucket[] {
  return buckets.map((b) => {
    const segments: StackSegment[] = [
      { key: "helpful", color: COLOR_HELPFUL, label: "Helpful", value: b.helpful },
      { key: "unhelpful", color: COLOR_UNHELPFUL, label: "Not helpful", value: b.unhelpful },
      { key: "nmr", color: COLOR_NMR, label: "NMR / pending", value: b.nmr },
    ];
    if (showNonCandidate) {
      segments.push({ key: "nonCandidate", color: COLOR_NON_CANDIDATE, label: "Non-candidate", value: b.nonCandidate });
    }
    return { key: b.key, label: b.label, segments };
  });
}

// In share mode each bar takes the notes rated helpful and splits them three
// ways: ours, the largest other AI note writer, and everyone writing by hand.
function shareToStacks(buckets: ShareBucket[]): StackBucket[] {
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    segments: [
      { key: "ours", color: COLOR_OURS, label: "Our notes", value: b.ours },
      { key: "otherAi", color: COLOR_OTHER_AI, label: "Top other AI", value: b.otherAi },
      { key: "human", color: COLOR_HUMAN, label: "Human-written", value: b.human },
    ],
  }));
}

interface HoverState {
  /** The centre of the bar in SVG coordinates. The scroll offset has not been
   *  subtracted yet. */
  slotCenter: number;
  absolute?: ChartBucket;
  stacked?: StackBucket;
}

export function BarChart({ buckets, shareBuckets, granularity, mode, width, showNonCandidate, showNmr }: BarChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  const stacks =
    mode === "share" ? shareToStacks(shareBuckets) : mode === "ratio" ? ratioToStacks(buckets, showNonCandidate) : null;
  const barCount = mode === "share" ? shareBuckets.length : buckets.length;

  const slotWidth = Math.max(
    1,
    (width - PAD_LEFT - PAD_RIGHT) / Math.min(MAX_VISIBLE_BARS, Math.max(barCount, 1)),
  );
  const svgWidth = Math.max(width, PAD_LEFT + PAD_RIGHT + slotWidth * barCount);
  const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const barWidth = slotWidth * (1 - BAR_GAP_FRAC);

  // The newest bucket sits on the right, so scroll all the way there whenever
  // the axis changes shape. That happens when the number of bars changes, when
  // the granularity changes, and when the mode changes. Any hover state is
  // cleared at the same time, so a tooltip from the old mode cannot linger.
  useEffect(() => {
    setHovered(null);
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
      setScrollLeft(el.scrollLeft);
    }
  }, [barCount, granularity, mode]);

  if (!barCount) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-sm text-gray-500">
        {mode === "share" ? "No platform-wide note data yet." : "No notes match the current selection."}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        onMouseLeave={() => setHovered(null)}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        {mode === "absolute" || mode === "posted" ? (
          <AbsoluteChart
            buckets={buckets}
            granularity={granularity}
            width={svgWidth}
            innerHeight={innerHeight}
            slotWidth={slotWidth}
            barWidth={barWidth}
            showNmr={showNmr}
            onHover={(bucket, slotCenter) => setHovered({ absolute: bucket, slotCenter })}
          />
        ) : (
          <StackedBars
            stacks={stacks!}
            granularity={granularity}
            width={svgWidth}
            innerHeight={innerHeight}
            slotWidth={slotWidth}
            barWidth={barWidth}
            onHover={(bucket, slotCenter) => setHovered({ stacked: bucket, slotCenter })}
          />
        )}
      </div>
      {hovered?.absolute && (
        <AbsoluteTooltip bucket={hovered.absolute} slotCenter={hovered.slotCenter} scrollLeft={scrollLeft} containerWidth={width} showNmr={showNmr} />
      )}
      {hovered?.stacked && (
        <StackedTooltip bucket={hovered.stacked} slotCenter={hovered.slotCenter} scrollLeft={scrollLeft} containerWidth={width} />
      )}
    </div>
  );
}

interface AbsoluteChartProps {
  buckets: ChartBucket[];
  granularity: ChartGranularity;
  width: number;
  innerHeight: number;
  slotWidth: number;
  barWidth: number;
  showNmr: boolean;
  onHover: (bucket: ChartBucket, slotCenter: number) => void;
}

function AbsoluteChart({ buckets, granularity, width, innerHeight, slotWidth, barWidth, showNmr, onHover }: AbsoluteChartProps) {
  // When the notes that need more ratings are shown, they stack in grey above
  // the green helpful bars. The upward part of a bar then measures every note
  // posted except the not-helpful ones, which hang below the zero line. The
  // upper axis is rescaled to fit that taller stack.
  const maxUpper = Math.max(0, ...buckets.map((b) => b.helpful + (showNmr ? b.nmr : 0)));
  const maxUnhelpful = Math.max(0, ...buckets.map((b) => b.unhelpful));
  const upperTicks = niceTicks(Math.max(maxUpper, 1));
  const lowerTicks = maxUnhelpful === 0 ? [0] : niceTicks(maxUnhelpful);
  const upperPlotMax = upperTicks[upperTicks.length - 1] ?? 1;
  const lowerPlotMax = lowerTicks[lowerTicks.length - 1] ?? 0;
  const totalRange = upperPlotMax + lowerPlotMax;

  const zeroY = totalRange === 0
    ? PAD_TOP + innerHeight / 2
    : PAD_TOP + (upperPlotMax / totalRange) * innerHeight;
  const upperPxPerUnit = totalRange === 0 ? 0 : (upperPlotMax / totalRange) * innerHeight / Math.max(upperPlotMax, 1);
  const lowerPxPerUnit = totalRange === 0 ? 0 : (lowerPlotMax / totalRange) * innerHeight / Math.max(lowerPlotMax, 1);
  const labelStep = tickLabelEvery(buckets.length);

  return (
    <svg width={width} height={CHART_HEIGHT} className="block">
      {upperTicks.map((t) => {
        const y = zeroY - t * upperPxPerUnit;
        return (
          <g key={`up-${t}`}>
            <line x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y} stroke={COLOR_AXIS} strokeDasharray="2 3" />
            <text x={PAD_LEFT - 6} y={y + 4} fontSize={10} fill={COLOR_LABEL} textAnchor="end">{t}</text>
          </g>
        );
      })}
      {lowerTicks.filter((t) => t > 0).map((t) => {
        const y = zeroY + t * lowerPxPerUnit;
        return (
          <g key={`dn-${t}`}>
            <line x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y} stroke={COLOR_AXIS} strokeDasharray="2 3" />
            <text x={PAD_LEFT - 6} y={y + 4} fontSize={10} fill={COLOR_LABEL} textAnchor="end">-{t}</text>
          </g>
        );
      })}

      <line x1={PAD_LEFT} y1={zeroY} x2={width - PAD_RIGHT} y2={zeroY} stroke={COLOR_LABEL} />

      {buckets.map((b, i) => {
        const xCenter = PAD_LEFT + slotWidth * (i + 0.5);
        const xBar = xCenter - barWidth / 2;
        const helpfulHeight = b.helpful * upperPxPerUnit;
        const nmrHeight = showNmr ? b.nmr * upperPxPerUnit : 0;
        const unhelpfulHeight = b.unhelpful * lowerPxPerUnit;
        return (
          <g key={b.key} onMouseEnter={() => onHover(b, xCenter)}>
            <rect
              x={xCenter - slotWidth / 2}
              y={PAD_TOP}
              width={slotWidth}
              height={innerHeight}
              fill="transparent"
            />
            {showNmr && b.nmr > 0 && (
              <rect x={xBar} y={zeroY - helpfulHeight - nmrHeight} width={barWidth} height={nmrHeight} fill={COLOR_NMR} />
            )}
            {b.helpful > 0 && (
              <rect x={xBar} y={zeroY - helpfulHeight} width={barWidth} height={helpfulHeight} fill={COLOR_HELPFUL} />
            )}
            {b.unhelpful > 0 && (
              <rect x={xBar} y={zeroY} width={barWidth} height={unhelpfulHeight} fill={COLOR_UNHELPFUL} />
            )}
            {i % labelStep === 0 && (
              <text x={xCenter} y={CHART_HEIGHT - PAD_BOTTOM + 16} fontSize={10} fill={COLOR_LABEL} textAnchor="middle">
                {b.label}
              </text>
            )}
          </g>
        );
      })}

      <text x={PAD_LEFT} y={CHART_HEIGHT - 8} fontSize={11} fill={COLOR_LABEL}>
        {granularity === "weekly" ? "Week" : "Day"} (UTC)
      </text>
    </svg>
  );
}

interface StackedBarsProps {
  stacks: StackBucket[];
  granularity: ChartGranularity;
  width: number;
  innerHeight: number;
  slotWidth: number;
  barWidth: number;
  onHover: (bucket: StackBucket, slotCenter: number) => void;
}

function StackedBars({ stacks, granularity, width, innerHeight, slotWidth, barWidth, onHover }: StackedBarsProps) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = tickLabelEvery(stacks.length);
  const yFor = (frac: number) => PAD_TOP + (1 - frac) * innerHeight;

  return (
    <svg width={width} height={CHART_HEIGHT} className="block">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD_LEFT} y1={yFor(t)} x2={width - PAD_RIGHT} y2={yFor(t)} stroke={COLOR_AXIS} strokeDasharray="2 3" />
          <text x={PAD_LEFT - 6} y={yFor(t) + 4} fontSize={10} fill={COLOR_LABEL} textAnchor="end">
            {(t * 100).toFixed(0)}%
          </text>
        </g>
      ))}

      {stacks.map((b, i) => {
        const total = stackTotal(b);
        if (total === 0) return null;
        const xCenter = PAD_LEFT + slotWidth * (i + 0.5);
        const xBar = xCenter - barWidth / 2;
        // Stack from the bottom up in segment order.
        let yCursor = PAD_TOP + innerHeight;
        const rects = b.segments.map((seg) => {
          const h = (seg.value / total) * innerHeight;
          yCursor -= h;
          return seg.value > 0 ? (
            <rect key={seg.key} x={xBar} y={yCursor} width={barWidth} height={h} fill={seg.color} />
          ) : null;
        });
        return (
          <g key={b.key} onMouseEnter={() => onHover(b, xCenter)}>
            <rect
              x={xCenter - slotWidth / 2}
              y={PAD_TOP}
              width={slotWidth}
              height={innerHeight}
              fill="transparent"
            />
            {rects}
            {i % labelStep === 0 && (
              <text x={xCenter} y={CHART_HEIGHT - PAD_BOTTOM + 16} fontSize={10} fill={COLOR_LABEL} textAnchor="middle">
                {b.label}
              </text>
            )}
          </g>
        );
      })}

      <text x={PAD_LEFT} y={CHART_HEIGHT - 8} fontSize={11} fill={COLOR_LABEL}>
        {granularity === "weekly" ? "Week" : "Day"} (UTC)
      </text>
    </svg>
  );
}

// Half of the tooltip's width, used to keep it inside the chart. The value is
// smaller than the tooltip really is, and that is deliberate. It is better for
// the tooltip to hang a little off the edge than for it to jump away from the
// bar it belongs to.
const TOOLTIP_HALF_WIDTH = 90;
const TOOLTIP_EDGE_MARGIN = 4;

function tooltipLeft(slotCenter: number, scrollLeft: number, containerWidth: number): number {
  const rawLeft = slotCenter - scrollLeft;
  return Math.max(
    TOOLTIP_HALF_WIDTH + TOOLTIP_EDGE_MARGIN,
    Math.min(containerWidth - TOOLTIP_HALF_WIDTH - TOOLTIP_EDGE_MARGIN, rawLeft),
  );
}

function TooltipShell({ left, label, children }: { left: number; label: string; children: React.ReactNode }) {
  return (
    <div
      style={{ left, transform: "translateX(-50%)" }}
      className="absolute top-1 pointer-events-none bg-gray-900 text-white text-xs rounded shadow-lg px-3 py-2 space-y-0.5 min-w-[180px]"
    >
      <div className="font-medium text-sm mb-1">{label}</div>
      {children}
    </div>
  );
}

function AbsoluteTooltip({
  bucket,
  slotCenter,
  scrollLeft,
  containerWidth,
  showNmr,
}: {
  bucket: ChartBucket;
  slotCenter: number;
  scrollLeft: number;
  containerWidth: number;
  showNmr: boolean;
}) {
  return (
    <TooltipShell left={tooltipLeft(slotCenter, scrollLeft, containerWidth)} label={bucket.label}>
      <TooltipRow color={COLOR_HELPFUL} label="Helpful" value={`${bucket.helpful}`} />
      <TooltipRow color={COLOR_UNHELPFUL} label="Not helpful" value={`${bucket.unhelpful}`} />
      {showNmr && <TooltipRow color={COLOR_NMR} label="Needs more ratings" value={`${bucket.nmr}`} />}
    </TooltipShell>
  );
}

function StackedTooltip({
  bucket,
  slotCenter,
  scrollLeft,
  containerWidth,
}: {
  bucket: StackBucket;
  slotCenter: number;
  scrollLeft: number;
  containerWidth: number;
}) {
  const total = stackTotal(bucket);
  const pct = (n: number) => (total === 0 ? "0.0%" : `${((n / total) * 100).toFixed(1)}%`);
  return (
    <TooltipShell left={tooltipLeft(slotCenter, scrollLeft, containerWidth)} label={bucket.label}>
      {bucket.segments.map((seg) => (
        <TooltipRow key={seg.key} color={seg.color} label={seg.label} value={`${pct(seg.value)} (${seg.value})`} />
      ))}
    </TooltipShell>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-gray-300 flex-1">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
