// Forest-plot pieces for the A/B comparison panel: a shared x-axis (CiAxis) and
// one CI block per row (CiBar). Both use the same x-scale so rows line up.
// Hand-rolled SVG, no chart library (BarChart.tsx is unrelated and untouched).

import type { Interval } from "../lib/confidenceIntervals";
import type { AbStatKind } from "../lib/abComparison";

const COLOR_BLOCK = "#10b981"; // helpful green, matches BarChart
const COLOR_BLOCK_FILL = "#a7f3d0"; // lighter green fill for the CI span
const COLOR_AXIS = "#d1d5db";
const COLOR_LABEL = "#6b7280";
const COLOR_ZERO = "#9ca3af";

// Horizontal inset so block edges / end caps don't clip at the SVG borders.
const AXIS_INSET = 8;
const ROW_HEIGHT = 22;
const AXIS_HEIGHT = 22;

export interface Domain {
  min: number;
  max: number;
}

function scaleX(value: number, domain: Domain, width: number): number {
  const inner = Math.max(1, width - 2 * AXIS_INSET);
  const t = (value - domain.min) / (domain.max - domain.min || 1);
  return AXIS_INSET + t * inner;
}

/** Pick a round tick step for a fractional range (e.g. 0.4 → 0.1). */
function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const norm = rough / base;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * base;
}

function niceTicks(domain: Domain, count = 5): number[] {
  const step = niceStep((domain.max - domain.min) / count);
  const start = Math.ceil(domain.min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= domain.max + step / 2; v += step) ticks.push(v);
  return ticks;
}

/**
 * Shared domain across all visible rows. Percent and cost stats fit the data
 * (clamped ≥ 0; percent also ≤ 1); the diff stat is symmetric around 0. Padded
 * so blocks don't touch the edges.
 */
export function computeDomain(intervals: Interval[], kind: AbStatKind): Domain {
  if (intervals.length === 0) return kind === "diff" ? { min: -0.1, max: 0.1 } : { min: 0, max: 1 };
  const lo = Math.min(...intervals.map((i) => i.lo));
  const hi = Math.max(...intervals.map((i) => i.hi));
  if (kind === "diff") {
    const m = Math.min(1, Math.max(0.05, Math.max(Math.abs(lo), Math.abs(hi)) * 1.1));
    return { min: -m, max: m };
  }
  const pad = Math.max(kind === "cost" ? 0.01 : 0.02, (hi - lo) * 0.08);
  const max = kind === "percent" ? Math.min(1, hi + pad) : hi + pad;
  return { min: Math.max(0, lo - pad), max };
}

function formatTick(v: number, kind: AbStatKind): string {
  if (kind === "cost") return v >= 10 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
  return `${(v * 100).toFixed(0)}%`;
}

export function CiAxis({ domain, width, kind }: { domain: Domain; width: number; kind: AbStatKind }) {
  if (width <= 0) return null;
  const ticks = niceTicks(domain);
  return (
    <svg width={width} height={AXIS_HEIGHT} className="overflow-visible">
      <line x1={AXIS_INSET} y1={4} x2={width - AXIS_INSET} y2={4} stroke={COLOR_AXIS} strokeWidth={1} />
      {ticks.map((t) => {
        const x = scaleX(t, domain, width);
        const atZero = kind === "diff" && Math.abs(t) < 1e-9;
        return (
          <g key={t}>
            <line x1={x} y1={4} x2={x} y2={8} stroke={COLOR_AXIS} strokeWidth={1} />
            <text x={x} y={18} textAnchor="middle" fontSize={10} fill={atZero ? COLOR_ZERO : COLOR_LABEL}>
              {formatTick(t, kind)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function CiBar({
  interval,
  domain,
  width,
  kind,
}: {
  interval: Interval;
  domain: Domain;
  width: number;
  kind: AbStatKind;
}) {
  if (width <= 0) return null;
  const midY = ROW_HEIGHT / 2;
  const xLo = scaleX(interval.lo, domain, width);
  const xHi = scaleX(interval.hi, domain, width);
  const xPoint = scaleX(interval.point, domain, width);
  const blockHeight = 12;
  return (
    <svg width={width} height={ROW_HEIGHT} className="overflow-visible">
      {kind === "diff" && (
        <line
          x1={scaleX(0, domain, width)}
          y1={0}
          x2={scaleX(0, domain, width)}
          y2={ROW_HEIGHT}
          stroke={COLOR_ZERO}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      {/* CI span — width is the size of the confidence interval */}
      <rect
        x={Math.min(xLo, xHi)}
        y={midY - blockHeight / 2}
        width={Math.max(1, Math.abs(xHi - xLo))}
        height={blockHeight}
        rx={3}
        fill={COLOR_BLOCK_FILL}
        stroke={COLOR_BLOCK}
        strokeWidth={1}
      />
      {/* point estimate marker */}
      <line x1={xPoint} y1={midY - blockHeight / 2 - 2} x2={xPoint} y2={midY + blockHeight / 2 + 2} stroke={COLOR_BLOCK} strokeWidth={2} />
    </svg>
  );
}
