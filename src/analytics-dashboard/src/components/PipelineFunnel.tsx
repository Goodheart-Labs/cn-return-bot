import { useMemo } from "react";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar, Polygon } from "@visx/shape";
import { Text } from "@visx/text";
import type { PipelineFunnelBars } from "../lib/queries";

/** A stage names how it relates to the one before it. A post yields many
 *  claims, so that step is a rate per post; every later step is a subset of
 *  the previous bar and reads as a share of it. */
type Stage = { key: keyof PipelineFunnelBars; label: string; unit: string; fromPrevious: "rate" | "share" | "none" };

const STAGES: readonly Stage[] = [
  { key: "items_processed", label: "Posts processed", unit: "post", fromPrevious: "none" },
  { key: "claims_extracted", label: "Claims extracted", unit: "claims", fromPrevious: "rate" },
  { key: "claims_checked", label: "Claims checked", unit: "claims", fromPrevious: "share" },
  { key: "ai_notes", label: "Notes written", unit: "notes", fromPrevious: "share" },
  { key: "ai_notes_helpful", label: "Notes rated helpful", unit: "notes", fromPrevious: "share" },
];

const CHART_HEIGHT = 320;
const MARGIN = { top: 44, bottom: 48 };
/** A bar with a count still shows as a sliver next to a much taller one. */
const MIN_VISIBLE_BAR_HEIGHT = 2;
/** The share of each stage's slot left as the gap the connector crosses. */
const GAP_FRACTION = 0.45;
const BAR_COLOR = "#2563eb";
const CONNECTOR_COLOR = "#2563eb";
const CONNECTOR_OPACITY = 0.18;
const LABEL_COLOR = "#6b7280";

/** The small line under a bar's count: "79 claims per post" for the rate
 *  step, "27% of claims" for a share step, nothing when the previous bar is
 *  empty. */
function fromPreviousLabel(stage: Stage, previous: Stage, value: number, previousValue: number): string {
  if (stage.fromPrevious === "none" || previousValue === 0) return "";
  if (stage.fromPrevious === "rate") return `${(value / previousValue).toFixed(1)} ${stage.unit} per ${previous.unit}`;
  return `${Math.round((value / previousValue) * 100)}% of ${previous.unit}`;
}

function Funnel({ bars, width }: { bars: PipelineFunnelBars; width: number }) {
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = useMemo(
    () => scaleBand<string>({ domain: STAGES.map((s) => s.key), range: [0, width], paddingInner: GAP_FRACTION, paddingOuter: 0.1 }),
    [width],
  );
  const maxValue = Math.max(1, ...STAGES.map((s) => bars[s.key]));
  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, maxValue], range: [innerHeight, 0] }), [maxValue, innerHeight]);
  const barWidth = xScale.bandwidth();

  return (
    <svg width={width} height={CHART_HEIGHT} style={{ display: "block" }}>
      <Group top={MARGIN.top}>
        {STAGES.map((stage, i) => {
          const next = STAGES[i + 1];
          if (!next) return null;
          const x0 = xScale(stage.key)! + barWidth;
          const x1 = xScale(next.key)!;
          const y0 = yScale(bars[stage.key]);
          const y1 = yScale(bars[next.key]);
          return (
            <Polygon
              key={`${stage.key}-to-${next.key}`}
              points={[
                [x0, y0],
                [x1, y1],
                [x1, innerHeight],
                [x0, innerHeight],
              ]}
              fill={CONNECTOR_COLOR}
              fillOpacity={CONNECTOR_OPACITY}
            />
          );
        })}
        {STAGES.map((stage, i) => {
          const x = xScale(stage.key)!;
          const value = bars[stage.key];
          const y = yScale(value);
          const previous = STAGES[i - 1];
          const barHeight = value > 0 ? Math.max(innerHeight - y, MIN_VISIBLE_BAR_HEIGHT) : 0;
          return (
            <Group key={stage.key}>
              <Bar x={x} y={innerHeight - barHeight} width={barWidth} height={barHeight} fill={BAR_COLOR} rx={3} />
              <Text x={x + barWidth / 2} y={innerHeight - barHeight - 22} textAnchor="middle" fontSize={15} fontWeight={600} fill="#111827">
                {value.toLocaleString()}
              </Text>
              {previous && (
                <Text x={x + barWidth / 2} y={innerHeight - barHeight - 7} textAnchor="middle" fontSize={11} fill={LABEL_COLOR}>
                  {fromPreviousLabel(stage, previous, value, bars[previous.key])}
                </Text>
              )}
              <Text x={x + barWidth / 2} y={innerHeight + 16} textAnchor="middle" fontSize={12} fill={LABEL_COLOR} width={barWidth + 24} verticalAnchor="start" lineHeight="1.3em">
                {stage.label}
              </Text>
            </Group>
          );
        })}
      </Group>
    </svg>
  );
}

/** Five bars, each a subset of the one before, joined by bands so the drop
 *  from stage to stage reads as one narrowing flow. */
export function PipelineFunnel({ bars }: { bars: PipelineFunnelBars }) {
  return <ParentSize debounceTime={50} style={{ height: CHART_HEIGHT }}>{({ width }) => width > 0 && <Funnel bars={bars} width={width} />}</ParentSize>;
}
