import { useEffect, useMemo, useState } from "react";
import { loadStatsSnapshot } from "./lib/loadData";
import type {
  ABFilters,
  ChartGranularity,
  ChartMode,
  NoteSort,
  StatsSnapshot,
} from "./lib/types";
import {
  bucketize,
  computeHeadlineMetrics,
  filterNotes,
  sortNotesForList,
} from "./lib/aggregations";
import { computeWritingLimitMetrics } from "./lib/writingLimit";
import { MetricsHeader } from "./components/MetricsHeader";
import { ChartControls, ChartLegend } from "./components/ChartControls";
import { BarChart } from "./components/BarChart";
import { NoteList } from "./components/NoteList";
import { AbFilterPanel } from "./components/ABFilters";
import { WritingLimitPanel } from "./components/WritingLimitPanel";
import { useResizeWidth } from "./lib/useResizeWidth";

export function App() {
  const [snapshot, setSnapshot] = useState<StatsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<ChartGranularity>("weekly");
  const [mode, setMode] = useState<ChartMode>("absolute");
  const [sort, setSort] = useState<NoteSort>("latest_helpful");
  const [devMode, setDevMode] = useState(false);
  const [abFilters, setAbFilters] = useState<ABFilters>({});

  useEffect(() => {
    loadStatsSnapshot().then(setSnapshot).catch((err) => setError(err.message));
  }, []);

  const filtersForData = devMode ? abFilters : {};
  const filteredNotes = useMemo(
    () => (snapshot ? filterNotes(snapshot.notes, filtersForData) : []),
    [snapshot, filtersForData],
  );
  const buckets = useMemo(
    () => bucketize(filteredNotes, granularity),
    [filteredNotes, granularity],
  );
  const metrics = useMemo(
    () =>
      snapshot
        ? computeHeadlineMetrics(snapshot.notes, snapshot.pipeline_run_aggregates, filtersForData)
        : null,
    [snapshot, filtersForData],
  );
  const sortedNotes = useMemo(() => sortNotesForList(filteredNotes, sort), [filteredNotes, sort]);
  const writingLimitMetrics = useMemo(
    () => (devMode ? computeWritingLimitMetrics(filteredNotes) : null),
    [devMode, filteredNotes],
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
          <h1 className="text-2xl font-semibold text-gray-900">AI Community Notes — Stats</h1>
          <p className="text-sm text-gray-500">
            Notes written by our AI notewriter. Snapshot generated{" "}
            {new Date(snapshot.generated_at).toLocaleString()}.
          </p>
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

      <MetricsHeader metrics={metrics} />

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-800">Notes over time</h2>
          <ChartControls
            granularity={granularity}
            mode={mode}
            onGranularityChange={setGranularity}
            onModeChange={setMode}
          />
        </div>
        <ChartLegend mode={mode} />
        <div ref={chartRef} className="w-full">
          <BarChart buckets={buckets} granularity={granularity} mode={mode} width={chartWidth} />
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
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
      <span>Developer mode</span>
      <span
        className={`relative inline-block w-9 h-5 rounded-full transition-colors ${devMode ? "bg-blue-600" : "bg-gray-300"}`}
        onClick={() => onChange(!devMode)}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${devMode ? "translate-x-4" : ""}`}
        />
      </span>
      <input
        type="checkbox"
        checked={devMode}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
    </label>
  );
}
