import { useState, useEffect, useMemo, useCallback } from "react";
import type {
  ReviewItem,
  DatasetOption,
  FilterState,
  FailureType,
  UploadInfo,
  FailureModeInfo,
} from "./lib/types";
import { FAILURE_TYPE_CONFIG } from "./lib/types";
import {
  fetchDashboardData,
  buildDashboardItems,
  fetchLogsForRuns,
  countsFromItems,
  fetchDatasetRunItems,
  fetchDatasetRunCounts,
  fetchUploads,
  fetchFailureModes,
  upsertAnnotation,
  createFailureMode,
  setFailureModeFixed,
  deleteUpload,
  pruneUnusedFailureModes,
} from "./lib/data";

const DISPLAY_PAGE_SIZE = 20;
// Production fetches are bounded by a date window on notes.submitted_at. The
// initial load covers the last WINDOW_DAYS_STEP days; "Load older notes" extends
// the window by another step. Keeping the window small is what makes the first
// paint fast — see fetchDashboardData.
const WINDOW_DAYS_STEP = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
import { NoteCard } from "./components/NoteCard";
import { FilterBar } from "./components/FilterBar";
import { DatasetSelector } from "./components/DatasetSelector";
import { UploadDialog } from "./components/UploadDialog";
import { AbFilterPanel } from "../../dashboard-shared/AbFilterPanel";
import {
  abTestOrdering,
  buildAbTestSlots,
  matchesAbFilters,
  type ABFilters,
} from "../../dashboard-shared/abFilters";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";

const { slotOrder: AB_TEST_SLOT_ORDER, variantOrder: AB_TEST_VARIANT_ORDER } =
  abTestOrdering(AB_TESTS);

function defaultFilters(source: "production" | "dataset_run"): FilterState {
  const failureTypes = new Set<FailureType>();
  for (const [ft, cfg] of Object.entries(FAILURE_TYPE_CONFIG) as [FailureType, typeof FAILURE_TYPE_CONFIG[FailureType]][]) {
    if (cfg.defaultOn && (source === "production" ? cfg.production : cfg.datasetRun)) {
      failureTypes.add(ft);
    }
  }
  return { seen: "unseen", failureTypes, failureModes: new Set() };
}

function byCreatedDesc(a: ReviewItem, b: ReviewItem): number {
  const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return db - da;
}

function matchesFilters(filters: FilterState, abFilters: ABFilters) {
  return (item: ReviewItem) => {
    if (!filters.failureTypes.has(item.failureType)) return false;
    if (filters.seen === "seen" && !(item.annotation?.seen)) return false;
    if (filters.seen === "unseen" && item.annotation?.seen) return false;
    if (filters.failureModes.size > 0) {
      const itemModes = item.annotation?.failureModes ?? [];
      if (!itemModes.some((m) => filters.failureModes.has(m))) return false;
    }
    if (!matchesAbFilters(item.abTestPicks ?? null, abFilters)) return false;
    return true;
  };
}

function initialDatasetFromUrl(): DatasetOption {
  if (typeof window === "undefined") return { type: "production", name: "Production" };
  const uploadId = new URLSearchParams(window.location.search).get("upload");
  if (uploadId) return { type: "dataset_run", id: uploadId, name: uploadId };
  return { type: "production", name: "Production" };
}

export function App() {
  const [dataset, setDataset] = useState<DatasetOption>(initialDatasetFromUrl);
  const [uploads, setUploads] = useState<UploadInfo[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filters, setFilters] = useState<FilterState>(defaultFilters("production"));
  const [abFilters, setAbFilters] = useState<ABFilters>({});
  const [counts, setCounts] = useState<Record<FailureType, number>>({} as any);
  const [failureModeCatalog, setFailureModeCatalog] = useState<FailureModeInfo[]>([]);
  const [showFixedTags, setShowFixedTags] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Production: all items are loaded up-front (metadata only, no TOAST). Logs
  // are lazy-loaded per visible card and cached here keyed by pipeline_run id.
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_PAGE_SIZE);
  const [logsByRunId, setLogsByRunId] = useState<Map<string, Record<string, unknown>>>(new Map());
  // Production date-window size, in days. Extends in WINDOW_DAYS_STEP increments
  // via "Load older notes". Dataset runs ignore this (bounded uploads).
  const [windowDays, setWindowDays] = useState(WINDOW_DAYS_STEP);

  // Load uploads and failure mode catalog on mount
  useEffect(() => {
    fetchUploads().then((all) => {
      setUploads(all);
      // Resolve placeholder name for ?upload=<id> initial dataset
      setDataset((d) => {
        if (d.type !== "dataset_run" || !d.id) return d;
        const match = all.find((u) => u.id === d.id);
        return match ? { type: "dataset_run", id: match.id, name: match.name } : d;
      });
    }).catch((e) => console.warn("Failed to fetch uploads (table may not exist yet):", e));
    fetchFailureModes().then(setFailureModeCatalog).catch((e) => console.warn("Failed to fetch failure modes (table may not exist yet):", e));
  }, []);

  // Load data when dataset changes. For production we fetch ALL metadata
  // (canonical + competing + pipeline_runs sans logs) in one shot; logs are
  // lazy-loaded per visible card in a separate effect below. Dataset runs
  // keep their original one-shot fetch (bounded set, already includes logs).
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (dataset.type === "production") {
        const since = new Date(Date.now() - windowDays * MS_PER_DAY).toISOString();
        const data = await fetchDashboardData(since);
        const built = buildDashboardItems(data);
        setItems(built);
        setCounts(countsFromItems(built));
        setLogsByRunId(new Map());
      } else {
        const loaded = await fetchDatasetRunItems(dataset.id!);
        setItems(loaded);
        setCounts(await fetchDatasetRunCounts(dataset.id!));
      }
    } catch (err: any) {
      console.error("Failed to load data:", err);
      setError(err?.message ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [dataset, windowDays]);

  // Reset filters and paging when the dataset changes (but not when only the
  // window extends — extending should preserve the user's filters and reveal).
  // windowDays intentionally persists across dataset switches; resetting it here
  // would re-fire loadData a second time on every switch.
  useEffect(() => {
    setFilters(defaultFilters(dataset.type));
    setAbFilters({});
    setDisplayLimit(DISPLAY_PAGE_SIZE);
  }, [dataset]);

  // Load whenever the dataset or the window changes. loadData is memoized on
  // both, so this fires once per meaningful change.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sort items by date (stable memo so renders don't re-sort unnecessarily).
  const sortedItems = useMemo(() => [...items].sort(byCreatedDesc), [items]);
  const filtered = sortedItems.filter(matchesFilters(filters, abFilters));

  // Derive A/B slots from observed ab_test_picks; sort by AB_TESTS
  // declaration order so dropdowns match the stats dashboard layout.
  const abSlots = useMemo(
    () =>
      buildAbTestSlots(
        items.map((i) => i.abTestPicks),
        AB_TEST_SLOT_ORDER,
        AB_TEST_VARIANT_ORDER,
      ),
    [items],
  );

  // Tag usage counts derived from current items' annotations. Used to sort
  // and label the failure-mode pills.
  const failureModeUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const m of item.annotation?.failureModes ?? []) {
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  const sortedFailureModes = useMemo(() => {
    const list = showFixedTags ? failureModeCatalog : failureModeCatalog.filter((m) => !m.fixed);
    return [...list].sort((a, b) => {
      const ca = failureModeUsage.get(a.name) ?? 0;
      const cb = failureModeUsage.get(b.name) ?? 0;
      if (cb !== ca) return cb - ca;
      return a.name.localeCompare(b.name);
    });
  }, [failureModeCatalog, failureModeUsage, showFixedTags]);

  const activeFailureModes = useMemo(
    () => failureModeCatalog.filter((m) => !m.fixed),
    [failureModeCatalog],
  );

  // Fold lazy-loaded logs into the items the list is about to render. Without
  // this, the first render sees logs=undefined; once the effect below fills
  // logsByRunId we want the cards to pick them up.
  const visibleRaw = dataset.type === "production" ? filtered.slice(0, displayLimit) : filtered;
  const visible = useMemo(
    () =>
      visibleRaw.map((item) => {
        const fromCache = item.pipelineRunId ? logsByRunId.get(item.pipelineRunId) : undefined;
        return fromCache ? { ...item, logs: fromCache } : item;
      }),
    [visibleRaw, logsByRunId],
  );
  // Two ways to see more in production: reveal already-loaded items (cheap), or
  // extend the date window to fetch older notes. The button does whichever is
  // next. Dataset runs are fully loaded, so only the reveal applies.
  const hasMoreInWindow = filtered.length > displayLimit;
  const canExtendWindow = dataset.type === "production";
  const canLoadMore = hasMoreInWindow || canExtendWindow;

  // Lazy-load logs for visible production items that don't have them yet.
  // Dataset runs already carry logs inline (they're small & come from uploads),
  // so this only fires for production.
  const visibleRunIdsKey = useMemo(
    () => visibleRaw.map((i) => i.pipelineRunId ?? "").join(","),
    [visibleRaw],
  );
  useEffect(() => {
    if (dataset.type !== "production") return;
    const needIds = Array.from(
      new Set(
        visibleRaw
          .map((i) => i.pipelineRunId)
          .filter((id): id is string => !!id && !logsByRunId.has(id)),
      ),
    );
    if (needIds.length === 0) return;
    setLoadingLogs(true);
    fetchLogsForRuns(needIds)
      .then((newLogs) => {
        if (newLogs.size === 0) return;
        setLogsByRunId((prev) => {
          const merged = new Map(prev);
          for (const [k, v] of newLogs) merged.set(k, v);
          return merged;
        });
      })
      .finally(() => setLoadingLogs(false));
    // visibleRunIdsKey guards against re-running when only object identity
    // changes but the actual set of visible items hasn't.
  }, [dataset.type, visibleRunIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMore = useCallback(() => {
    if (hasMoreInWindow) {
      setDisplayLimit((prev) => prev + DISPLAY_PAGE_SIZE);
      return;
    }
    // Everything in the current window is shown — fetch an older slice. Bump the
    // display limit too so the newly fetched notes are revealed, not hidden
    // behind another click.
    setWindowDays((prev) => prev + WINDOW_DAYS_STEP);
    setDisplayLimit((prev) => prev + DISPLAY_PAGE_SIZE);
  }, [hasMoreInWindow]);

  // Annotation handlers
  const handleSeenToggle = async (id: string, seen: boolean) => {
    const source = dataset.type === "production" ? "production" : "dataset_run";
    const targetId = dataset.type === "production" ? id : id;
    try {
      await upsertAnnotation(source as "production" | "dataset_run", targetId, { seen });
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, annotation: { ...item.annotation, seen, failureModes: item.annotation?.failureModes ?? [] } }
            : item,
        ),
      );
    } catch (err: any) {
      console.error("Failed to update seen:", err);
    }
  };

  const handleFailureModesChange = async (id: string, modes: string[]) => {
    const source = dataset.type === "production" ? "production" : "dataset_run";
    try {
      await upsertAnnotation(source as "production" | "dataset_run", id, { failureModes: modes });
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, annotation: { ...item.annotation, seen: item.annotation?.seen ?? false, failureModes: modes } }
            : item,
        ),
      );
      pruneUnusedFailureModes().then(setFailureModeCatalog).catch(() => {});
    } catch (err: any) {
      console.error("Failed to update failure modes:", err);
    }
  };

  const handleCommentChange = async (id: string, comment: string | null) => {
    const source = dataset.type === "production" ? "production" : "dataset_run";
    try {
      await upsertAnnotation(source as "production" | "dataset_run", id, { comment: comment ?? "" });
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, annotation: { ...item.annotation, seen: item.annotation?.seen ?? false, failureModes: item.annotation?.failureModes ?? [], comment: comment ?? undefined } }
            : item,
        ),
      );
    } catch (err: any) {
      console.error("Failed to update comment:", err);
    }
  };

  const handleCreateFailureMode = async (name: string) => {
    try {
      await createFailureMode(name);
      setFailureModeCatalog((prev) => {
        const existing = prev.find((m) => m.name === name);
        if (existing) {
          return existing.fixed ? prev.map((m) => (m.name === name ? { ...m, fixed: false } : m)) : prev;
        }
        return [...prev, { name, fixed: false }].sort((a, b) => a.name.localeCompare(b.name));
      });
    } catch (err: any) {
      console.error("Failed to create failure mode:", err);
    }
  };

  const handleToggleFixed = async (name: string, fixed: boolean) => {
    setFailureModeCatalog((prev) =>
      prev.map((m) => (m.name === name ? { ...m, fixed } : m)),
    );
    if (fixed) {
      setFilters((prev) => {
        if (!prev.failureModes.has(name)) return prev;
        const next = new Set(prev.failureModes);
        next.delete(name);
        return { ...prev, failureModes: next };
      });
    }
    try {
      await setFailureModeFixed(name, fixed);
    } catch (err: any) {
      console.error("Failed to update failure mode fixed status:", err);
      setFailureModeCatalog((prev) =>
        prev.map((m) => (m.name === name ? { ...m, fixed: !fixed } : m)),
      );
    }
  };

  const handleDatasetChange = (option: DatasetOption) => {
    setDataset(option);
  };

  const handleDeleteUpload = async (id: string) => {
    try {
      await deleteUpload(id);
      setUploads((prev) => prev.filter((u) => u.id !== id));
      if (dataset.type === "dataset_run" && dataset.id === id) {
        setDataset({ type: "production", name: "Production" });
      }
      pruneUnusedFailureModes().then(setFailureModeCatalog).catch(() => {});
    } catch (err: any) {
      console.error("Failed to delete upload:", err);
    }
  };

  const handleUploaded = (id: string, name: string) => {
    fetchUploads().then(setUploads).catch(() => {});
    setDataset({ type: "dataset_run", id, name });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">Note Review</h1>
        <DatasetSelector
          current={dataset}
          uploads={uploads}
          onChange={handleDatasetChange}
          onUploadClick={() => setUploadOpen(true)}
          onDeleteUpload={handleDeleteUpload}
        />
      </div>

      {/* Filters */}
      <div className="mb-4">
        <FilterBar
          source={dataset.type}
          filters={filters}
          counts={counts}
          onFiltersChange={setFilters}
        />
      </div>

      {/* A/B test filters */}
      {abSlots.length > 0 && (
        <div className="mb-4">
          <AbFilterPanel slots={abSlots} filters={abFilters} onChange={setAbFilters} />
        </div>
      )}

      {/* Failure mode filter pills */}
      {failureModeCatalog.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4 items-center">
          {sortedFailureModes.map((mode) => {
            const active = filters.failureModes.has(mode.name);
            const count = failureModeUsage.get(mode.name) ?? 0;
            return (
              <span
                key={mode.name}
                className={`group inline-flex items-center text-xs rounded-full border transition-colors ${
                  mode.fixed
                    ? "bg-gray-50 text-gray-400 border-gray-200 line-through"
                    : active
                      ? "bg-purple-100 text-purple-800 border-purple-300"
                      : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                }`}
              >
                <button
                  onClick={() => {
                    const next = new Set(filters.failureModes);
                    if (active) next.delete(mode.name);
                    else next.add(mode.name);
                    setFilters({ ...filters, failureModes: next });
                  }}
                  className="pl-2 pr-1 py-0.5"
                >
                  {mode.name}
                  {count > 0 && (
                    <span className="ml-1 text-[10px] opacity-60">{count}</span>
                  )}
                </button>
                <button
                  onClick={() => handleToggleFixed(mode.name, !mode.fixed)}
                  title={mode.fixed ? "Mark as not fixed" : "Mark as fixed"}
                  className="pr-2 pl-0.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100"
                >
                  {mode.fixed ? "↺" : "✓"}
                </button>
              </span>
            );
          })}
          <label className="ml-2 inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showFixedTags}
              onChange={(e) => setShowFixedTags(e.target.checked)}
              className="rounded"
            />
            Show fixed
          </label>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 text-red-700 rounded-lg p-3 mb-4 text-sm">{error}</div>
      )}

      {/* Item count */}
      <div className="text-sm text-gray-500 mb-3">
        {loading && items.length === 0
          ? "Loading..."
          : dataset.type === "production"
            ? `Showing ${visible.length} of ${filtered.length} · last ${windowDays} days${loadingLogs ? " · loading logs…" : ""}`
            : `${filtered.length} items shown`}
      </div>

      {/* Items */}
      <div className="space-y-3">
        {visible.map((item) => (
          <NoteCard
            key={item.id}
            item={item}
            failureModeCatalog={activeFailureModes}
            failureModeUsage={failureModeUsage}
            onSeenToggle={handleSeenToggle}
            onFailureModesChange={handleFailureModesChange}
            onCreateFailureMode={handleCreateFailureMode}
            onCommentChange={handleCommentChange}
          />
        ))}
      </div>

      {/* Load more */}
      {canLoadMore && (
        <div className="flex justify-center mt-6">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {loading
              ? "Loading…"
              : hasMoreInWindow
                ? `Load more (${DISPLAY_PAGE_SIZE})`
                : `Load older notes (+${WINDOW_DAYS_STEP} days)`}
          </button>
        </div>
      )}

      {/* Upload dialog */}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
