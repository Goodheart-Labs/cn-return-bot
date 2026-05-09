import type { ChartBucket } from "../lib/aggregations";
import type { ChartGranularity, ChartMode } from "../lib/types";

const CHART_HEIGHT = 320;
const PAD_TOP = 12;
const PAD_BOTTOM = 50;
const PAD_LEFT = 50;
const PAD_RIGHT = 12;
const BAR_GAP_FRAC = 0.2;

const COLOR_HELPFUL = "#10b981";
const COLOR_UNHELPFUL = "#ef4444";
const COLOR_NMR = "#9ca3af";
const COLOR_AXIS = "#d1d5db";
const COLOR_LABEL = "#6b7280";

interface BarChartProps {
  buckets: ChartBucket[];
  granularity: ChartGranularity;
  mode: ChartMode;
  width: number;
}

function niceTicks(maxValue: number, count = 4): number[] {
  if (maxValue === 0) return [0];
  const step = niceStep(maxValue / count);
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + step / 2; v += step) ticks.push(v);
  return ticks;
}

function niceStep(rough: number): number {
  if (rough <= 0) return 1;
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

export function BarChart({ buckets, granularity, mode, width }: BarChartProps) {
  if (!buckets.length) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-sm text-gray-500">
        No notes match the current selection.
      </div>
    );
  }

  const innerWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slotWidth = innerWidth / buckets.length;
  const barWidth = slotWidth * (1 - BAR_GAP_FRAC);

  const inner: InnerProps = { buckets, granularity, width, innerHeight, slotWidth, barWidth };
  return mode === "ratio" ? <RatioChart {...inner} /> : <AbsoluteChart {...inner} />;
}

interface InnerProps {
  buckets: ChartBucket[];
  granularity: ChartGranularity;
  width: number;
  innerHeight: number;
  slotWidth: number;
  barWidth: number;
}

function tickLabelEvery(buckets: ChartBucket[]): number {
  // Show roughly 8 x-axis labels max so they don't collide.
  const maxLabels = 8;
  return Math.max(1, Math.ceil(buckets.length / maxLabels));
}

function AbsoluteChart({ buckets, granularity, width, innerHeight, slotWidth, barWidth }: InnerProps) {
  const maxHelpful = Math.max(0, ...buckets.map((b) => b.helpful));
  const maxUnhelpful = Math.max(0, ...buckets.map((b) => b.unhelpful));
  const upperMax = Math.max(maxHelpful, 1);
  const lowerMax = Math.max(maxUnhelpful, 0);
  // Always axis-symmetric? No — give each side its own scale; the axis tells you.
  const upperTicks = niceTicks(upperMax);
  const lowerTicks = lowerMax === 0 ? [0] : niceTicks(lowerMax);
  const upperPlotMax = Math.max(upperMax, upperTicks[upperTicks.length - 1] ?? 0);
  const lowerPlotMax = Math.max(lowerMax, lowerTicks[lowerTicks.length - 1] ?? 0);

  const totalRange = upperPlotMax + lowerPlotMax;
  const zeroY = totalRange === 0
    ? PAD_TOP + innerHeight / 2
    : PAD_TOP + (upperPlotMax / totalRange) * innerHeight;
  const upperPxPerUnit = totalRange === 0 ? 0 : (upperPlotMax / totalRange) * innerHeight / Math.max(upperPlotMax, 1);
  const lowerPxPerUnit = totalRange === 0 ? 0 : (lowerPlotMax / totalRange) * innerHeight / Math.max(lowerPlotMax, 1);

  const labelStep = tickLabelEvery(buckets);

  return (
    <svg width={width} height={CHART_HEIGHT} className="block">
      {/* Y-axis ticks */}
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

      {/* Zero line */}
      <line x1={PAD_LEFT} y1={zeroY} x2={width - PAD_RIGHT} y2={zeroY} stroke={COLOR_LABEL} />

      {/* Bars */}
      {buckets.map((b, i) => {
        const xCenter = PAD_LEFT + slotWidth * (i + 0.5);
        const xBar = xCenter - barWidth / 2;
        const helpfulHeight = b.helpful * upperPxPerUnit;
        const unhelpfulHeight = b.unhelpful * lowerPxPerUnit;
        return (
          <g key={b.key}>
            {b.helpful > 0 && (
              <rect x={xBar} y={zeroY - helpfulHeight} width={barWidth} height={helpfulHeight} fill={COLOR_HELPFUL}>
                <title>{`${b.label}: ${b.helpful} helpful`}</title>
              </rect>
            )}
            {b.unhelpful > 0 && (
              <rect x={xBar} y={zeroY} width={barWidth} height={unhelpfulHeight} fill={COLOR_UNHELPFUL}>
                <title>{`${b.label}: ${b.unhelpful} unhelpful`}</title>
              </rect>
            )}
            {i % labelStep === 0 && (
              <text x={xCenter} y={CHART_HEIGHT - PAD_BOTTOM + 16} fontSize={10} fill={COLOR_LABEL} textAnchor="middle">
                {b.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Axis labels */}
      <text x={PAD_LEFT} y={CHART_HEIGHT - 8} fontSize={11} fill={COLOR_LABEL}>
        {granularity === "weekly" ? "Week" : "Day"} (UTC)
      </text>
    </svg>
  );
}

function RatioChart({ buckets, granularity, width, innerHeight, slotWidth, barWidth }: InnerProps) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = tickLabelEvery(buckets);
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
        if (b.total === 0) return null;
        const xCenter = PAD_LEFT + slotWidth * (i + 0.5);
        const xBar = xCenter - barWidth / 2;
        const helpfulFrac = b.helpful / b.total;
        const unhelpfulFrac = b.unhelpful / b.total;
        const nmrFrac = b.nmr / b.total;
        const helpfulH = helpfulFrac * innerHeight;
        const unhelpfulH = unhelpfulFrac * innerHeight;
        const nmrH = nmrFrac * innerHeight;
        const helpfulY = PAD_TOP;
        const unhelpfulY = helpfulY + helpfulH;
        const nmrY = unhelpfulY + unhelpfulH;
        return (
          <g key={b.key}>
            <rect x={xBar} y={helpfulY} width={barWidth} height={helpfulH} fill={COLOR_HELPFUL}>
              <title>{`${b.label}: ${(helpfulFrac * 100).toFixed(1)}% helpful (${b.helpful}/${b.total})`}</title>
            </rect>
            <rect x={xBar} y={unhelpfulY} width={barWidth} height={unhelpfulH} fill={COLOR_UNHELPFUL}>
              <title>{`${b.label}: ${(unhelpfulFrac * 100).toFixed(1)}% not helpful (${b.unhelpful}/${b.total})`}</title>
            </rect>
            <rect x={xBar} y={nmrY} width={barWidth} height={nmrH} fill={COLOR_NMR}>
              <title>{`${b.label}: ${(nmrFrac * 100).toFixed(1)}% NMR / pending (${b.nmr}/${b.total})`}</title>
            </rect>
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
