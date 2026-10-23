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
  selectHighImpactNotes,
  dropInProgressWeek,
  filterNotes,
  sortNotesForList,
} from "./lib/aggregations";
import { computeWritingLimitMetrics } from "./lib/writingLimit";
import { MetricsHeader, PublicMetrics } from "./components/MetricsHeader";
import { ChartControls, ChartLegend } from "./components/ChartControls";
import { BarChart } from "./components/BarChart";
import { NoteList } from "./components/NoteList";
import { AbFilterPanel } from "../../dashboard-shared/AbFilterPanel";
import { AbComparisonPanel } from "./components/AbComparisonPanel";
import {
  buildAbCombos,
  buildFailureModeCatalog,
  buildRatingReasonCatalog,
  windowStartDate,
  type AbComparisonStat,
} from "./lib/abComparison";
import type { ConfidenceLevel } from "./lib/confidenceIntervals";
import { WritingLimitPanel } from "./components/WritingLimitPanel";
import { PipelineHealthPanel } from "./components/PipelineHealthPanel";
import { useResizeWidth } from "./lib/useResizeWidth";

// One shared empty object. Handing the useMemos below a fresh {} on every render
// would make them all recompute whenever developer mode is off.
const EMPTY_FILTERS: ABFilters = {};

const isDeveloperView = () => new URLSearchParams(window.location.search).get("view") === "developer";

export function App() {
  const [snapshot, setSnapshot] = useState<StatsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<ChartGranularity>("weekly");
  const [mode, setMode] = useState<ChartMode>("absolute");
  const [sort, setSort] = useState<NoteSort>("most_views_helpful");
  const [devMode, setDevMode] = useState(isDeveloperView);
  const [showNonCandidate, setShowNonCandidate] = useState(false);
  const showNmr = mode === "posted";
  const [abFilters, setAbFilters] = useState<ABFilters>({});
  const [cmpDims, setCmpDims] = useState<string[]>([]);
  const [cmpStat, setCmpStat] = useState<AbComparisonStat>({ kind: "pct_helpful" });
  const [cmpWindowDays, setCmpWindowDays] = useState<number | null>(null);
  const [cmpIncludeNonCandidate, setCmpIncludeNonCandidate] = useState(false);
  const [cmpLevel, setCmpLevel] = useState<ConfidenceLevel>(95);
  const [cmpHidden, setCmpHidden] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    loadStatsSnapshot().then(setSnapshot).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const onPopState = () => setDevMode(isDeveloperView());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const changeView = (developer: boolean) => {
    const url = new URL(window.location.href);
    if (developer) url.searchParams.set("view", "developer");
    else url.searchParams.delete("view");
    window.history.pushState(null, "", url);
    setDevMode(developer);
  };

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
  // The "% of all" buckets count notes across the whole platform, so the A/B
  // filters do not apply to them. Those filters only narrow down our own notes.
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
        ? buildAbCombos(snapshot.notes, snapshot.ab_outcome_aggregates, cmpDims, filtersForData, windowStartDate(cmpWindowDays))
        : [],
    [devMode, snapshot, cmpDims, filtersForData, cmpWindowDays],
  );
  // The metric submenus list every failure mode and every rating reason in the
  // whole snapshot, not only the ones inside the chosen window. That keeps the
  // lists from shifting around as the user changes filters.
  const failureModeCatalog = useMemo(
    () => (snapshot ? buildFailureModeCatalog(snapshot.notes) : []),
    [snapshot],
  );
  const ratingReasonCatalog = useMemo(
    () => (snapshot ? buildRatingReasonCatalog(snapshot.notes) : { positive: [], negative: [] }),
    [snapshot],
  );
  const sortedNotes = useMemo(
    () => devMode ? sortNotesForList(filteredNotes, sort) : selectHighImpactNotes(filteredNotes),
    [filteredNotes, devMode, sort],
  );
  const writingLimitMetrics = useMemo(
    () => (devMode && snapshot ? computeWritingLimitMetrics(snapshot.notes) : null),
    [devMode, snapshot],
  );

  const [chartRef, chartWidth] = useResizeWidth<HTMLDivElement>();

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">AI-written Community Notes</h1>
          <p className="mt-2 text-sm text-gray-600">
            {devMode ? "Pipeline health, performance and experiments." : "Explore our selected high-impact notes, starting with the ones seen most on X."}
          </p>
          {snapshot && <p className="mt-1 text-xs text-gray-500">
            Snapshot updated {new Date(snapshot.generated_at).toLocaleString()}.
          </p>}
        </div>
        <ViewSwitcher devMode={devMode} onChange={changeView} />
      </header>

      {devMode && <PipelineHealthPanel />}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load historical stats. {error}
      </div>}
      {!error && (!snapshot || !metrics) && <p className="text-sm text-gray-500">Loading stats…</p>}

      {snapshot && metrics && <>
      {!devMode && (
        <>
          <PublicMetrics notes={sortedNotes} />
          <NoteList key="public" variant="public" notes={sortedNotes} sort="most_views_helpful" onSortChange={setSort} />
        </>
      )}

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
          failureModeCatalog={failureModeCatalog}
          ratingReasonCatalog={ratingReasonCatalog}
          windowDays={cmpWindowDays}
          onWindowDaysChange={setCmpWindowDays}
          includeNonCandidate={cmpIncludeNonCandidate}
          onIncludeNonCandidateChange={setCmpIncludeNonCandidate}
          level={cmpLevel}
          onLevelChange={setCmpLevel}
          hidden={cmpHidden}
          onHiddenChange={setCmpHidden}
        />
      )}

      {devMode && <MetricsHeader metrics={metrics} />}

      {devMode && (
        <section aria-label="Notes over time" className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-800">Notes over time</h2>
            <ChartControls
              granularity={granularity}
              mode={mode}
              showNonCandidate={showNonCandidate}
              devMode={devMode}
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
              showNmr={showNmr}
            />
          </div>
        </section>
      )}

      {devMode && writingLimitMetrics && <WritingLimitPanel metrics={writingLimitMetrics} />}

      {devMode && <NoteList key="developer" variant="developer" notes={sortedNotes} sort={sort} onSortChange={setSort} />}
      </>}
    </div>
  );
}

function ViewSwitcher({
  devMode,
  onChange,
}: {
  devMode: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div role="group" aria-label="Dashboard view" className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1 text-sm">
      {[{ label: "Public", developer: false }, { label: "Developer", developer: true }].map(({ label, developer }) => (
        <button
          key={label}
          type="button"
          aria-pressed={devMode === developer}
          onClick={() => { if (devMode !== developer) onChange(developer); }}
          className={`rounded-md px-4 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${devMode === developer ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
