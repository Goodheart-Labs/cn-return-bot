import { useMemo, useState } from "react";
import type { QueryRequest } from "@cn/core/fieldQuery";
import type { NotewriterSource } from "@cn/core/notewriter";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { Card } from "@cn/ui/Card";
import { Checkbox } from "@cn/ui/Field";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { SectionTitle } from "@cn/ui/typography";
import { ChartLegend } from "../../components/chart/ChartLegend";
import { StackedBarChart, type Bar, type BarPart } from "../../components/chart/StackedBarChart";
import { bucketLabel, noteBuckets, originBuckets, type Granularity } from "./chartBuckets";
import { useNoteDays, useOriginDays } from "./queries";

export type ChartMode = "counts" | "posted" | "ratio" | "share";

const PARTS = {
  helpful: { key: "helpful", label: "Helpful", color: "var(--cn-positive-solid)" },
  notHelpful: { key: "notHelpful", label: "Not helpful", color: "var(--cn-negative-solid)" },
  needsRatings: { key: "needsRatings", label: "Needs more ratings", color: "var(--cn-fg-subtle)" },
  notSubmittedRuns: { key: "notSubmittedRuns", label: "Runs that wrote no note", color: "var(--cn-line)" },
  ours: { key: "ours", label: "Our notes", color: "var(--cn-series-1)" },
  otherAi: { key: "otherAi", label: "Top other AI note writers", color: "var(--cn-series-2)" },
  human: { key: "human", label: "Written by people", color: "var(--cn-series-3)" },
} satisfies Record<string, BarPart>;

/** The parts each chart mode stacks, and whether its bars show shares. */
function chartLayout(mode: ChartMode, withRuns: boolean): { up: BarPart[]; down: BarPart[]; shares: boolean } {
  if (mode === "counts") return { up: [PARTS.helpful], down: [PARTS.notHelpful], shares: false };
  if (mode === "posted") return { up: [PARTS.helpful, PARTS.needsRatings], down: [PARTS.notHelpful], shares: false };
  if (mode === "ratio") return { up: [PARTS.helpful, PARTS.notHelpful, PARTS.needsRatings, ...(withRuns ? [PARTS.notSubmittedRuns] : [])], down: [], shares: true };
  return { up: [PARTS.ours, PARTS.otherAi, PARTS.human], down: [], shares: true };
}

const MODE_LABELS: Record<ChartMode, string> = { counts: "Helpful / unhelpful", posted: "Posted", ratio: "Ratio", share: "% of all notes" };

/** The notes written per day or week, coloured by their rating. `modes` are
 *  the views offered, the first one shown at the start. On the X page the "%
 *  of all notes" mode shows who wrote all the notes X rates helpful instead,
 *  so the filters do not change it. */
export function NotesOverTime({ source, request, modes }: { source: NotewriterSource; request: QueryRequest; modes: readonly ChartMode[] }) {
  const [granularity, setGranularity] = useState<Granularity>("weekly");
  const [chosenMode, setMode] = useState<ChartMode>(modes[0]!);
  const [withRuns, setWithRuns] = useState(false);
  // A mode that is no longer offered, such as Ratio after leaving developer
  // mode, falls back to the first.
  const mode = modes.includes(chosenMode) ? chosenMode : modes[0]!;
  const showRuns = mode === "ratio" && withRuns;
  const days = useNoteDays(source, request, showRuns);
  const originDays = useOriginDays(mode === "share");
  const today = new Date().toISOString().slice(0, 10);
  const layout = chartLayout(mode, showRuns);
  const loaded = mode === "share" ? originDays : days;
  const bars: Bar[] | undefined = useMemo(() => {
    const buckets = mode === "share" ? originDays.data && originBuckets(originDays.data, granularity, today) : days.data && noteBuckets(days.data, granularity, today);
    return buckets?.map(({ key, start, ...values }) => ({ key, label: bucketLabel(start, granularity), values }));
  }, [mode, originDays.data, days.data, granularity, today]);

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Notes over time</SectionTitle>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
          <SegmentedControl label="Bar size" value={granularity} onChange={setGranularity} options={[{ id: "weekly", label: "Weekly" }, { id: "daily", label: "Daily" }]} />
          {/* On a phone the modes do not fit in one row, so they scroll. */}
          <div className="min-w-0 max-w-full overflow-x-auto">
            <SegmentedControl label="What the bars show" value={mode} onChange={setMode} options={modes.map((m) => ({ id: m, label: MODE_LABELS[m] }))} />
          </div>
          {mode === "ratio" && (
            <Checkbox checked={withRuns} onChange={setWithRuns} className="text-sm text-fg-secondary">
              Include non-candidate runs
            </Checkbox>
          )}
        </div>
      </div>
      <ChartLegend
        items={[...layout.up, ...layout.down]}
        note={mode === "share" ? "Who wrote all the Community Notes that X rates helpful." : mode === "ratio" ? "Each bar is 100% of that week's or day's notes." : undefined}
      />
      {loaded.isError ? (
        <LoadFailed what="The chart" onRetry={() => void loaded.refetch()} />
      ) : bars ? (
        <StackedBarChart bars={bars} {...layout} emptyText="No notes match these filters." />
      ) : (
        <p className="py-16 text-center text-sm text-fg-muted">Loading…</p>
      )}
    </Card>
  );
}
