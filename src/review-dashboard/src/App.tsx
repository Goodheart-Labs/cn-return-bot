import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  fetchRecentNotesLight,
  fetchAllRatedDashboardData,
  fetchDashboardDataByTags,
  buildDashboardItems,
  fetchLogsForRuns,
  fetchProductionCounts,
  fetchProductionTagCounts,
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

// Production load is two phases. Phase 1 paints the DEFAULT VIEW itself — every
// note whose status the default filter shows (see DEFAULT_VIEW_STATUSES) — so the
// whole set you land on appears at once (the server prefetches it into the HTML
// for an instant first open). Phase 2 then merges in everything else (other
// statuses, missed opps, low-eval, competitor data) so flipping a filter is
// instant. The default category is small (~hundreds), so it loads whole — no
// "load more". The limit is just a safety cap.
const DEFAULT_VIEW_LIMIT = 1000;

// cn_status for the note-backed failure types; lets us turn the default filter
// into a server-side status filter for the phase-1 paint. Types not here
// (lost_to_competitor / missed / low-eval) need satellite data, so they only
// arrive in phase 2.
const CN_STATUS_BY_FAILURE_TYPE: Partial<Record<FailureType, string>> = {
  rated_helpful: "CURRENTLY_RATED_HELPFUL",
  rated_unhelpful: "CURRENTLY_RATED_NOT_HELPFUL",
  needs_more_ratings: "NEEDS_MORE_RATINGS",
};

// The cn_statuses the default production filter shows — what phase 1 fetches.
const DEFAULT_VIEW_STATUSES: string[] = (() => {
  const out: string[] = [];
  for (const [ft, cfg] of Object.entries(FAILURE_TYPE_CONFIG) as [FailureType, typeof FAILURE_TYPE_CONFIG[FailureType]][]) {
    const status = CN_STATUS_BY_FAILURE_TYPE[ft];
    if (status && cfg.defaultOn && cfg.production) out.push(status);
  }
  return out.length ? out : ["CURRENTLY_RATED_NOT_HELPFUL"];
})();
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
    // When tags are selected they're the primary lens: show every item carrying
    // one, regardless of failure type or seen state. Tagged items are usually
    // already marked seen, and many failure types are off by default, so
    // applying those filters here would hide the very items you clicked to see.
    if (filters.failureModes.size > 0) {
      const itemModes = item.annotation?.failureModes ?? [];
      if (!itemModes.some((m) => filters.failureModes.has(m))) return false;
    } else {
      if (!filters.failureTypes.has(item.failureType)) return false;
      if (filters.seen === "seen" && !(item.annotation?.seen)) return false;
      if (filters.seen === "unseen" && item.annotation?.seen) return false;
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
  // All-time tag usage for production pills, fetched once per production
  // session and adjusted optimistically on tag edits. Dataset runs derive
  // counts from their (fully loaded) items instead.
  const [productionTagCounts, setProductionTagCounts] = useState<Map<string, number>>(new Map());
  const [failureModeCatalog, setFailureModeCatalog] = useState<FailureModeInfo[]>([]);
  const [showFixedTags, setShowFixedTags] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Production: the default view paints first, then all rated items load up-front
  // (metadata only, no TOAST). Logs are lazy-loaded per visible card and cached
  // here keyed by pipeline_run id.
  const [logsByRunId, setLogsByRunId] = useState<Map<string, Record<string, unknown>>>(new Map());
  // True while the background phase-2 load (everything beyond the default view)
  // is in flight after the fast first paint. Drives the "loading…" suffix.
  const [backfilling, setBackfilling] = useState(false);

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

  // Selecting failure-mode tags makes production loading fetch all-time tagged
  // items instead of the most-recent set, so the tag set is a fetch input.
  // Serialize it for a stable loadData dep — the Set's identity churns on
  // unrelated re-renders. Empty for dataset runs, whose tag filtering is client-side.
  const productionTagKey = useMemo(
    () =>
      dataset.type === "production"
        ? JSON.stringify([...filters.failureModes].sort())
        : "",
    [dataset.type, filters.failureModes],
  );

  // Monotonic id per loadData call; the phase-2 background load checks it before
  // writing state so a dataset or filter change mid-load can't clobber the new view.
  const loadSeq = useRef(0);

  // Load data when the dataset changes. Production paints the default view
  // immediately (prefetched into the page, or a light fetch), then merges in all
  // rated items in the background. A tag filter bypasses the two phases and loads
  // all-time tagged items in one shot. Pill counts are all-time (a separate
  // effect), so we don't set them here. Dataset runs keep their one-shot fetch.
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      if (dataset.type === "production") {
        const tags = [...filters.failureModes];
        if (tags.length > 0) {
          const data = await fetchDashboardDataByTags(tags);
          if (seq !== loadSeq.current) return;
          setItems(buildDashboardItems(data));
          setLogsByRunId(new Map());
          return;
        }
        // Phase 1: the default view itself — the newest notes whose status the
        // default filter shows. On the initial open the server has already
        // prefetched this and injected it as window.__DEFAULT_VIEW__, so we paint
        // synchronously with zero round-trips. We consume it once (later reloads,
        // e.g. after a filter change, fetch fresh). Falls back to a light client
        // fetch when the injected snapshot is absent.
        const injected = (window as any).__DEFAULT_VIEW__;
        (window as any).__DEFAULT_VIEW__ = null;
        const defaultView =
          injected && injected.canonical?.length
            ? injected
            : await fetchRecentNotesLight(DEFAULT_VIEW_STATUSES, DEFAULT_VIEW_LIMIT);
        if (seq !== loadSeq.current) return;
        setItems(buildDashboardItems(defaultView));
        setLogsByRunId(new Map());
        setLoading(false);

        // Phase 2: everything else (other statuses, missed opps, low-eval, and
        // competitor comparisons) merged in behind the default view — a UNION,
        // not a swap, so nothing already on screen disappears. Phase-2 rows win
        // on overlap (they carry competitor data); annotation edits made during
        // the load survive.
        setBackfilling(true);
        fetchAllRatedDashboardData()
          .then((full) => {
            if (seq !== loadSeq.current) return;
            const fullItems = buildDashboardItems(full);
            setItems((prev) => {
              const prevAnnotation = new Map(prev.map((i) => [i.id, i.annotation]));
              const merged = new Map(prev.map((i) => [i.id, i]));
              for (const item of fullItems) {
                const edited = prevAnnotation.get(item.id);
                merged.set(item.id, edited ? { ...item, annotation: edited } : item);
              }
              return [...merged.values()];
            });
          })
          .catch((err) => {
            console.error("Background load failed:", err);
            if (seq === loadSeq.current) setError(err?.message ?? "Failed to load more notes");
          })
          .finally(() => {
            if (seq === loadSeq.current) setBackfilling(false);
          });
      } else {
        const loaded = await fetchDatasetRunItems(dataset.id!);
        setItems(loaded);
        setCounts(await fetchDatasetRunCounts(dataset.id!));
      }
    } catch (err: any) {
      console.error("Failed to load data:", err);
      if (seq === loadSeq.current) setError(err?.message ?? "Failed to load data");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
    // productionTagKey is the stable proxy for filters.failureModes (read above).
  }, [dataset, productionTagKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset filters when the dataset changes. Re-firing loadData is fine; it's
  // memoized on dataset + productionTagKey.
  useEffect(() => {
    setFilters(defaultFilters(dataset.type));
    setAbFilters({});
  }, [dataset]);

  // Load whenever the dataset (or tag filter) changes. loadData is memoized on
  // those, so this fires once per meaningful change.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Production pill counts are all-time and independent of what's loaded, so
  // fetch them once per production session.
  useEffect(() => {
    if (dataset.type !== "production") return;
    fetchProductionCounts()
      .then(setCounts)
      .catch((e) => console.warn("Failed to fetch production counts:", e));
    fetchProductionTagCounts()
      .then(setProductionTagCounts)
      .catch((e) => console.warn("Failed to fetch production tag counts:", e));
  }, [dataset]);

  // Sort items by date (stable memo so renders don't re-sort unnecessarily).
  const sortedItems = useMemo(() => [...items].sort(byCreatedDesc), [items]);
  const filtered = sortedItems.filter(matchesFilters(filters, abFilters));

  // Failure-type pill counts. The fully-loaded rated categories reflect the
  // current seen + A/B filters (so "Rated Unhelpful" shows how many are left to
  // review, not the all-time total); the rest — needs-more-ratings, missed,
  // low-eval, which aren't fully loaded — keep their all-time counts.
  const SEEN_AWARE_TYPES: FailureType[] = ["rated_helpful", "rated_unhelpful", "lost_to_competitor"];
  const displayCounts = useMemo(() => {
    if (dataset.type !== "production") return counts;
    const derived = { ...counts };
    for (const ft of SEEN_AWARE_TYPES) derived[ft] = 0;
    for (const item of items) {
      if (!SEEN_AWARE_TYPES.includes(item.failureType)) continue;
      if (filters.seen === "seen" && !item.annotation?.seen) continue;
      if (filters.seen === "unseen" && item.annotation?.seen) continue;
      if (!matchesAbFilters(item.abTestPicks ?? null, abFilters)) continue;
      derived[item.failureType] = (derived[item.failureType] ?? 0) + 1;
    }
    return derived;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.type, counts, items, filters.seen, abFilters]);

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

  // Tag usage counts derived from current items' annotations — correct for
  // dataset runs, whose items are fully loaded.
  const itemTagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const m of item.annotation?.failureModes ?? []) {
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  // Counts used to sort and label the pills (and order the card selector).
  // Production loads only rated notes (not needs_more_ratings etc.), so use the
  // all-time counts there; deriving from items would undercount.
  const tagCounts = dataset.type === "production" ? productionTagCounts : itemTagCounts;

  const sortedFailureModes = useMemo(() => {
    const list = showFixedTags ? failureModeCatalog : failureModeCatalog.filter((m) => !m.fixed);
    return [...list].sort((a, b) => {
      const ca = tagCounts.get(a.name) ?? 0;
      const cb = tagCounts.get(b.name) ?? 0;
      if (cb !== ca) return cb - ca;
      return a.name.localeCompare(b.name);
    });
  }, [failureModeCatalog, tagCounts, showFixedTags]);

  const activeFailureModes = useMemo(
    () => failureModeCatalog.filter((m) => !m.fixed),
    [failureModeCatalog],
  );

  // Fold lazy-loaded logs into the items the list is about to render. Without
  // this, the first render sees logs=undefined; once the effect below fills
  // logsByRunId we want the cards to pick them up.
  const visible = useMemo(
    () =>
      filtered.map((item) => {
        const fromCache = item.pipelineRunId ? logsByRunId.get(item.pipelineRunId) : undefined;
        return fromCache ? { ...item, logs: fromCache } : item;
      }),
    [filtered, logsByRunId],
  );
  const tagFilterActive = dataset.type === "production" && filters.failureModes.size > 0;

  // Lazy-load logs for visible production items that don't have them yet.
  // Dataset runs already carry logs inline (they're small & come from uploads),
  // so this only fires for production.
  const visibleRunIdsKey = useMemo(
    () => visible.map((i) => i.pipelineRunId ?? "").join(","),
    [visible],
  );
  useEffect(() => {
    if (dataset.type !== "production") return;
    const needIds = Array.from(
      new Set(
        visible
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
    const prevModes = items.find((item) => item.id === id)?.annotation?.failureModes ?? [];
    try {
      await upsertAnnotation(source as "production" | "dataset_run", id, { failureModes: modes });
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, annotation: { ...item.annotation, seen: item.annotation?.seen ?? false, failureModes: modes } }
            : item,
        ),
      );
      // Keep the all-time pill counts in step without refetching: apply the
      // same add/remove diff we just persisted.
      if (dataset.type === "production") {
        setProductionTagCounts((prev) => {
          const next = new Map(prev);
          for (const m of modes) {
            if (!prevModes.includes(m)) next.set(m, (next.get(m) ?? 0) + 1);
          }
          for (const m of prevModes) {
            if (modes.includes(m)) continue;
            const remaining = (next.get(m) ?? 1) - 1;
            if (remaining > 0) next.set(m, remaining);
            else next.delete(m);
          }
          return next;
        });
      }
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
          counts={displayCounts}
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
            const count = tagCounts.get(mode.name) ?? 0;
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
            ? tagFilterActive
              ? `${visible.length} notes · all time, tagged${loadingLogs ? " · loading logs…" : ""}`
              : `${visible.length} notes${backfilling ? " · loading more…" : ""}${loadingLogs ? " · loading logs…" : ""}`
            : `${filtered.length} items shown`}
      </div>

      {/* Items */}
      <div className="space-y-3">
        {visible.map((item) => (
          <NoteCard
            key={item.id}
            item={item}
            failureModeCatalog={activeFailureModes}
            failureModeUsage={tagCounts}
            onSeenToggle={handleSeenToggle}
            onFailureModesChange={handleFailureModesChange}
            onCreateFailureMode={handleCreateFailureMode}
            onCommentChange={handleCommentChange}
          />
        ))}
      </div>

      {/* Upload dialog */}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
