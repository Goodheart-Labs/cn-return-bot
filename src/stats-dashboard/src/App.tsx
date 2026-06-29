import { useEffect, useMemo, useState } from "react";
import { loadStatsSnapshot } from "./lib/loadData";
import type {
  ChartGranularity,
  ChartMode,
  NoteSort,
  StatsSnapshot,
} from "./lib/types";
import type { ABFilters } from "../../dashboard-shared/abFilters";
import {
  bucketize,
  bucketizeOrigin,
  computeHeadlineMetrics,
  dropInProgressWeek,
  filterNotes,
  sortNotesForList,
} from "./lib/aggregations";
import { computeWritingLimitMetrics } from "./lib/writingLimit";
import { MetricsHeader } from "./components/MetricsHeader";
import { ChartControls, ChartLegend } from "./components/ChartControls";
import { BarChart } from "./components/BarChart";
import { NoteList } from "./components/NoteList";
import { AbFilterPanel } from "../../dashboard-shared/AbFilterPanel";
import { AbComparisonPanel } from "./components/AbComparisonPanel";
import { buildAbCombos, type AbComparisonStat } from "./lib/abComparison";
import type { ConfidenceLevel } from "./lib/confidenceIntervals";
import { WritingLimitPanel } from "./components/WritingLimitPanel";
import { useResizeWidth } from "./lib/useResizeWidth";

// Stable reference so the downstream useMemos don't invalidate every render
// when developer mode is off.
const EMPTY_FILTERS: ABFilters = {};

export function App() {
  const [snapshot, setSnapshot] = useState<StatsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<ChartGranularity>("weekly");
  const [mode, setMode] = useState<ChartMode>("absolute");
  const [sort, setSort] = useState<NoteSort>("latest_helpful");
  const [devMode, setDevMode] = useState(false);
  const [showNonCandidate, setShowNonCandidate] = useState(false);
  const [abFilters, setAbFilters] = useState<ABFilters>({});
  const [cmpDims, setCmpDims] = useState<string[]>([]);
  const [cmpStat, setCmpStat] = useState<AbComparisonStat>("pct_helpful");
  const [cmpIncludeNonCandidate, setCmpIncludeNonCandidate] = useState(false);
  const [cmpLevel, setCmpLevel] = useState<ConfidenceLevel>(95);
  const [cmpHidden, setCmpHidden] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    loadStatsSnapshot().then(setSnapshot).catch((err) => setError(err.message));
  }, []);

  const filtersForData = devMode ? abFilters : EMPTY_FILTERS;
  const filteredNotes = useMemo(
    () => (snapshot ? filterNotes(snapshot.notes, filtersForData) : []),
    [snapshot, filtersForData],
  );
  const useNonCandidate = devMode && showNonCandidate;
  const buckets = useMemo(
    () =>
      dropInProgressWeek(
        bucketize(
          filteredNotes,
          granularity,
          useNonCandidate ? snapshot?.pipeline_runs_by_day : undefined,
          filtersForData,
        ),
        granularity,
      ),
    [filteredNotes, granularity, useNonCandidate, snapshot, filtersForData],
  );
  // "% of all" share buckets: platform-wide, so independent of the AB filters
  // (those only scope our own notes).
  const shareBuckets = useMemo(
    () => dropInProgressWeek(bucketizeOrigin(snapshot?.daily_note_origin_counts ?? [], granularity), granularity),
    [snapshot, granularity],
  );
  const metrics = useMemo(
    () =>
      snapshot
        ? computeHeadlineMetrics(snapshot.notes, snapshot.pipeline_run_aggregates, filtersForData)
        : null,
    [snapshot, filtersForData],
  );
  const abCombos = useMemo(
    () =>
      devMode && snapshot
        ? buildAbCombos(snapshot.notes, snapshot.ab_outcome_aggregates, cmpDims, filtersForData)
        : [],
    [devMode, snapshot, cmpDims, filtersForData],
  );
  const sortedNotes = useMemo(() => sortNotesForList(filteredNotes, sort), [filteredNotes, sort]);
  const writingLimitMetrics = useMemo(
    () => (devMode && snapshot ? computeWritingLimitMetrics(snapshot.notes) : null),
    [devMode, snapshot],
  );

  const [chartRef, chartWidth] = useResizeWidth<HTMLDivElement>();

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-semibold text-red-700 mb-2">Failed to load stats data</h1>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{error}</p>
      </div>
    );
  }
  if (!snapshot || !metrics) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-sm text-gray-500">Loading…</div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">AI written Community Notes</h1>
          {devMode && (
            <p className="text-sm text-gray-500">
              Snapshot generated {new Date(snapshot.generated_at).toLocaleString()}.
            </p>
          )}
        </div>
        <DevModeToggle devMode={devMode} onChange={setDevMode} />
      </header>

      {devMode && (
        <AbFilterPanel
          slots={snapshot.ab_test_slots}
          filters={abFilters}
          onChange={setAbFilters}
        />
      )}

      {devMode && (
        <AbComparisonPanel
          slots={snapshot.ab_test_slots}
          combos={abCombos}
          dims={cmpDims}
          onDimsChange={setCmpDims}
          stat={cmpStat}
          onStatChange={setCmpStat}
          includeNonCandidate={cmpIncludeNonCandidate}
          onIncludeNonCandidateChange={setCmpIncludeNonCandidate}
          level={cmpLevel}
          onLevelChange={setCmpLevel}
          hidden={cmpHidden}
          onHiddenChange={setCmpHidden}
        />
      )}

      <MetricsHeader metrics={metrics} />

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-800">Notes over time</h2>
          <ChartControls
            granularity={granularity}
            mode={mode}
            showNonCandidate={showNonCandidate}
            showNonCandidateAvailable={devMode}
            onGranularityChange={setGranularity}
            onModeChange={setMode}
            onShowNonCandidateChange={setShowNonCandidate}
          />
        </div>
        <ChartLegend mode={mode} showNonCandidate={useNonCandidate} />
        <div ref={chartRef} className="w-full">
          <BarChart
            buckets={buckets}
            shareBuckets={shareBuckets}
            granularity={granularity}
            mode={mode}
            width={chartWidth}
            showNonCandidate={useNonCandidate}
          />
        </div>
      </section>

      {devMode && writingLimitMetrics && <WritingLimitPanel metrics={writingLimitMetrics} />}

      <NoteList notes={sortedNotes} sort={sort} onSortChange={setSort} />
    </div>
  );
}

function DevModeToggle({
  devMode,
  onChange,
}: {
  devMode: boolean;
  onChange: (next: boolean) => void;
}) {
  // One button captures clicks on both the label text and the visual switch.
  // The previous label + nested span + sr-only checkbox double-fired when the
  // user clicked the visual switch (span onClick toggled, label-associated
  // checkbox also toggled — canceling each other).
  return (
    <button
      type="button"
      role="switch"
      aria-checked={devMode}
      onClick={() => onChange(!devMode)}
      className="inline-flex items-center gap-2 text-sm text-gray-600 select-none cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
    >
      <span>Developer mode</span>
      <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${devMode ? "bg-blue-600" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${devMode ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}
