import { useMemo } from "react";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar, Polygon } from "@visx/shape";
import { Text } from "@visx/text";
import type { PipelineFunnelBars } from "../lib/queries";

const STAGES: readonly { key: keyof PipelineFunnelBars; label: string; unit: string }[] = [
  { key: "items_processed", label: "Posts processed", unit: "posts" },
  { key: "claims_extracted", label: "Claims extracted", unit: "claims" },
  { key: "claims_checked", label: "Claims checked", unit: "claims" },
  { key: "ai_notes", label: "Notes written", unit: "notes" },
  { key: "ai_notes_helpful", label: "Notes rated helpful", unit: "notes" },
];

const CHART_HEIGHT = 300;
const MARGIN = { top: 44, bottom: 32 };
/** The share of each stage's slot left as the gap the connector crosses. */
const GAP_FRACTION = 0.45;
const BAR_COLOR = "#2563eb";
const CONNECTOR_COLOR = "#2563eb";
const CONNECTOR_OPACITY = 0.18;
const LABEL_COLOR = "#6b7280";

const percentOf = (part: number, whole: number) => (whole === 0 ? "" : `${Math.round((part / whole) * 100)}%`);

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
          const previous = i > 0 ? bars[STAGES[i - 1]!.key] : null;
          return (
            <Group key={stage.key}>
              <Bar x={x} y={y} width={barWidth} height={innerHeight - y} fill={BAR_COLOR} rx={3} />
              <Text x={x + barWidth / 2} y={y - 22} textAnchor="middle" fontSize={15} fontWeight={600} fill="#111827">
                {value.toLocaleString()}
              </Text>
              {previous !== null && (
                <Text x={x + barWidth / 2} y={y - 7} textAnchor="middle" fontSize={11} fill={LABEL_COLOR}>
                  {percentOf(value, previous) && `${percentOf(value, previous)} of ${STAGES[i - 1]!.unit}`}
                </Text>
              )}
              <Text x={x + barWidth / 2} y={innerHeight + 18} textAnchor="middle" fontSize={12} fill={LABEL_COLOR} width={barWidth + 24} verticalAnchor="start">
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
  return <ParentSize debounceTime={50}>{({ width }) => width > 0 && <Funnel bars={bars} width={width} />}</ParentSize>;
}
