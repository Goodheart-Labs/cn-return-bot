import { useEffect, useRef, useState } from "react";
import type { ChartBucket } from "../lib/aggregations";
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
const COLOR_AXIS = "#d1d5db";
const COLOR_LABEL = "#6b7280";

interface BarChartProps {
  buckets: ChartBucket[];
  granularity: ChartGranularity;
  mode: ChartMode;
  width: number;
  showNonCandidate: boolean;
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

// Pick the bar interval at which to render an x-axis label so the user sees
// ~TARGET_LABELS_IN_VIEW labels in any scrolled slice of the chart. Density
// is measured against the smaller of the dataset and the viewport — for
// datasets shorter than the viewport we show ~7 labels overall; for longer
// scrolling datasets we show ~7 labels in any 28-bar window.
const TARGET_LABELS_IN_VIEW = 7;
function tickLabelEvery(numBars: number): number {
  const effectiveBars = Math.min(numBars, MAX_VISIBLE_BARS);
  return Math.max(1, Math.ceil(effectiveBars / TARGET_LABELS_IN_VIEW));
}

interface HoverState {
  bucket: ChartBucket;
  /** Bar center in SVG coordinates (before subtracting scrollLeft). */
  slotCenter: number;
}

export function BarChart({ buckets, granularity, mode, width, showNonCandidate }: BarChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  const slotWidth = Math.max(
    1,
    (width - PAD_LEFT - PAD_RIGHT) / Math.min(MAX_VISIBLE_BARS, Math.max(buckets.length, 1)),
  );
  const svgWidth = Math.max(width, PAD_LEFT + PAD_RIGHT + slotWidth * buckets.length);
  const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const barWidth = slotWidth * (1 - BAR_GAP_FRAC);

  // Latest bucket is rightmost; show it first whenever the time axis
  // changes. Mode and the non-candidate toggle don't reshape the axis, so
  // keep the user's scroll position across those.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
      setScrollLeft(el.scrollLeft);
    }
  }, [buckets.length, granularity]);

  if (!buckets.length) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-sm text-gray-500">
        No notes match the current selection.
      </div>
    );
  }

  const inner: InnerProps = {
    buckets,
    granularity,
    width: svgWidth,
    innerHeight,
    slotWidth,
    barWidth,
    showNonCandidate,
    onHover: (bucket, slotCenter) => setHovered({ bucket, slotCenter }),
  };

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        onMouseLeave={() => setHovered(null)}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        {mode === "ratio" ? <RatioChart {...inner} /> : <AbsoluteChart {...inner} />}
      </div>
      <ChartTooltip
        hover={hovered}
        scrollLeft={scrollLeft}
        containerWidth={width}
        mode={mode}
        showNonCandidate={showNonCandidate}
      />
    </div>
  );
}

interface InnerProps {
  buckets: ChartBucket[];
  granularity: ChartGranularity;
  width: number;
  innerHeight: number;
  slotWidth: number;
  barWidth: number;
  showNonCandidate: boolean;
  onHover: (bucket: ChartBucket, slotCenter: number) => void;
}

function AbsoluteChart({ buckets, granularity, width, innerHeight, slotWidth, barWidth, onHover }: InnerProps) {
  const maxHelpful = Math.max(0, ...buckets.map((b) => b.helpful));
  const maxUnhelpful = Math.max(0, ...buckets.map((b) => b.unhelpful));
  const upperTicks = niceTicks(Math.max(maxHelpful, 1));
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

function RatioChart({ buckets, granularity, width, innerHeight, slotWidth, barWidth, showNonCandidate, onHover }: InnerProps) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = tickLabelEvery(buckets.length);
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

      {buckets.map((b, i) => {
        // When the non-candidate toggle is off, ignore that segment from the
        // denominator so the visible segments still sum to 100%.
        const denom = showNonCandidate ? b.total : b.helpful + b.unhelpful + b.nmr;
        if (denom === 0) return null;
        const xCenter = PAD_LEFT + slotWidth * (i + 0.5);
        const xBar = xCenter - barWidth / 2;
        const helpfulH = (b.helpful / denom) * innerHeight;
        const unhelpfulH = (b.unhelpful / denom) * innerHeight;
        const nmrH = (b.nmr / denom) * innerHeight;
        const nonCandidateH = showNonCandidate ? (b.nonCandidate / denom) * innerHeight : 0;
        // Stack from the bottom up: helpful, unhelpful, nmr, non-candidate.
        const helpfulY = PAD_TOP + innerHeight - helpfulH;
        const unhelpfulY = helpfulY - unhelpfulH;
        const nmrY = unhelpfulY - nmrH;
        const nonCandidateY = nmrY - nonCandidateH;
        return (
          <g key={b.key} onMouseEnter={() => onHover(b, xCenter)}>
            <rect
              x={xCenter - slotWidth / 2}
              y={PAD_TOP}
              width={slotWidth}
              height={innerHeight}
              fill="transparent"
            />
            <rect x={xBar} y={helpfulY} width={barWidth} height={helpfulH} fill={COLOR_HELPFUL} />
            <rect x={xBar} y={unhelpfulY} width={barWidth} height={unhelpfulH} fill={COLOR_UNHELPFUL} />
            <rect x={xBar} y={nmrY} width={barWidth} height={nmrH} fill={COLOR_NMR} />
            {showNonCandidate && nonCandidateH > 0 && (
              <rect x={xBar} y={nonCandidateY} width={barWidth} height={nonCandidateH} fill={COLOR_NON_CANDIDATE} />
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

// Approximate tooltip width used to clamp the anchored x-position against
// the chart edges. Smaller than the actual rendered width so we err on the
// side of "tooltip slightly off-screen" rather than "tooltip jumps away
// from the bar".
const TOOLTIP_HALF_WIDTH = 90;
const TOOLTIP_EDGE_MARGIN = 4;

function ChartTooltip({
  hover,
  scrollLeft,
  containerWidth,
  mode,
  showNonCandidate,
}: {
  hover: HoverState | null;
  scrollLeft: number;
  containerWidth: number;
  mode: ChartMode;
  showNonCandidate: boolean;
}) {
  if (!hover) return null;
  const { bucket, slotCenter } = hover;
  const denom = showNonCandidate ? bucket.total : bucket.helpful + bucket.unhelpful + bucket.nmr;
  const pct = (n: number) => (denom === 0 ? "0.0%" : `${((n / denom) * 100).toFixed(1)}%`);

  const rawLeft = slotCenter - scrollLeft;
  const clampedLeft = Math.max(
    TOOLTIP_HALF_WIDTH + TOOLTIP_EDGE_MARGIN,
    Math.min(containerWidth - TOOLTIP_HALF_WIDTH - TOOLTIP_EDGE_MARGIN, rawLeft),
  );

  return (
    <div
      style={{ left: clampedLeft, transform: "translateX(-50%)" }}
      className="absolute top-1 pointer-events-none bg-gray-900 text-white text-xs rounded shadow-lg px-3 py-2 space-y-0.5 min-w-[180px]"
    >
      <div className="font-medium text-sm mb-1">{bucket.label}</div>
      <TooltipRow color={COLOR_HELPFUL} label="Helpful" value={mode === "ratio" ? `${pct(bucket.helpful)} (${bucket.helpful})` : `${bucket.helpful}`} />
      <TooltipRow color={COLOR_UNHELPFUL} label="Not helpful" value={mode === "ratio" ? `${pct(bucket.unhelpful)} (${bucket.unhelpful})` : `${bucket.unhelpful}`} />
      {mode === "ratio" && (
        <TooltipRow color={COLOR_NMR} label="NMR / pending" value={`${pct(bucket.nmr)} (${bucket.nmr})`} />
      )}
      {mode === "ratio" && showNonCandidate && (
        <TooltipRow color={COLOR_NON_CANDIDATE} label="Non-candidate" value={`${pct(bucket.nonCandidate)} (${bucket.nonCandidate})`} />
      )}
    </div>
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
