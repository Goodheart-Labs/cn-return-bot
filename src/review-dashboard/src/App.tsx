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
import { resolveRatingCounts } from "../../dashboard-shared/Ratings";
import { WINDOW_DAYS_STEP } from "../../dashboard-shared/productionView";
import {
  fetchDashboardData,
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

// Production fetches are bounded by a date window on notes.submitted_at. The
// initial load covers the last WINDOW_DAYS_STEP days; "Load older notes" extends
// the window by another step. Keeping the window small is what makes the first
// paint fast — see fetchDashboardData. WINDOW_DAYS_STEP is shared with the server
// prefetch (productionView).
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
  // Production opens on "All" (seen + unseen); dataset-run review still defaults
  // to "Unseen" so you work through the un-reviewed ones.
  return { seen: source === "production" ? "all" : "unseen", failureTypes, failureModes: new Set() };
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
  // Production: all items in the current date window are loaded up-front
  // (metadata only, no TOAST). Logs are lazy-loaded per visible card and cached
  // here keyed by pipeline_run id.
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

  // Selecting failure-mode tags makes production loading fetch all-time tagged
  // items instead of the date window, so the tag set is a fetch input. Serialize
  // it for a stable loadData dep — the Set's identity churns on unrelated
  // re-renders. Empty for dataset runs, whose tag filtering stays client-side.
  const productionTagKey = useMemo(
    () =>
      dataset.type === "production"
        ? JSON.stringify([...filters.failureModes].sort())
        : "",
    [dataset.type, filters.failureModes],
  );

  // Load data when dataset changes. For production we fetch ALL metadata
  // (canonical + competing + pipeline_runs sans logs) in one shot; logs are
  // lazy-loaded per visible card in a separate effect below. Dataset runs
  // keep their original one-shot fetch (bounded set, already includes logs).
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (dataset.type === "production") {
        // The list is windowed; the pill counts are all-time (fetched once by a
        // separate effect), so we don't set them here. Selecting tags swaps the
        // window for an all-time fetch of everything ever tagged, so the pills
        // filter across all history (see fetchDashboardDataByTags).
        const tags = [...filters.failureModes];
        if (tags.length === 0) {
          // Instant first paint: the server prefetches the default (unhelpful)
          // window and injects it as window.__DEFAULT_VIEW__. Paint it with zero
          // round-trips, then load the full window (which also brings in
          // competing / missed / low-eval) and replace. Consumed once, so window
          // extends and later reloads fetch fresh.
          const injected = (window as any).__DEFAULT_VIEW__;
          (window as any).__DEFAULT_VIEW__ = null;
          if (injected?.canonical?.length) {
            setItems(buildDashboardItems(injected));
            setLoading(false);
          }
        }
        const data = tags.length > 0
          ? await fetchDashboardDataByTags(tags)
          : await fetchDashboardData(new Date(Date.now() - windowDays * MS_PER_DAY).toISOString());
        setItems(buildDashboardItems(data));
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
    // productionTagKey is the stable proxy for filters.failureModes (read above).
  }, [dataset, windowDays, productionTagKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset filters when the dataset changes (but not when only the window
  // extends — extending should preserve the user's filters). windowDays
  // intentionally persists across dataset switches; resetting it here would
  // re-fire loadData a second time on every switch.
  useEffect(() => {
    setFilters(defaultFilters(dataset.type));
    setAbFilters({});
  }, [dataset]);

  // Load whenever the dataset or the window changes. loadData is memoized on
  // both, so this fires once per meaningful change.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Production pill counts are all-time and independent of the date window, so
  // fetch them once per production session rather than on every window extension.
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
  // Production items are only partially loaded (date window), so use the
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
  // logsByRunId we want the cards to pick them up. Every filtered item in the
  // current window renders — to see more, extend the window (production only).
  const visible = useMemo(
    () =>
      filtered.map((item) => {
        const fromCache = item.pipelineRunId ? logsByRunId.get(item.pipelineRunId) : undefined;
        return fromCache ? { ...item, logs: fromCache } : item;
      }),
    [filtered, logsByRunId],
  );
  const tagFilterActive = dataset.type === "production" && filters.failureModes.size > 0;
  // An all-time tag fetch already loaded everything tagged; no window to extend.
  const canLoadMore = dataset.type === "production" && !tagFilterActive;

  // The list is newest-first, so the top is often freshly-submitted notes with
  // no ratings yet. Offer a jump to the first note that actually has ratings —
  // only useful when some unrated notes precede it (index > 0).
  const firstRatedIndex = useMemo(
    () => visible.findIndex((item) => {
      const { helpful, notHelpful } = resolveRatingCounts(item.publicDumpRatings, item.helpfulCount, item.notHelpfulCount);
      return helpful + notHelpful > 0;
    }),
    [visible],
  );
  const scrollToFirstRated = useCallback(() => {
    const target = visible[firstRatedIndex];
    if (!target) return;
    const id = `note-${target.id}`;
    // Cards above the target lazy-load tweet media + logs as they scroll into
    // view, so each scroll grows the content above and pushes the target down —
    // a single scrollIntoView lands far short (worse the more notes precede it).
    // Re-align repeatedly, letting layout settle between tries, until the target
    // holds at the top across a few consecutive checks (or we hit the cap).
    let tries = 0;
    let stable = 0;
    const align = () => {
      const el = document.getElementById(id);
      if (!el || tries >= 40) return;
      tries++;
      const top = el.getBoundingClientRect().top;
      if (Math.abs(top) <= 4) {
        if (++stable >= 3) return;
      } else {
        stable = 0;
        el.scrollIntoView({ block: "start" });
      }
      setTimeout(align, 150);
    };
    align();
  }, [visible, firstRatedIndex]);

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

  const handleLoadMore = useCallback(() => {
    setWindowDays((prev) => prev + WINDOW_DAYS_STEP);
  }, []);

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

      {/* Item count + jump-to-rated */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-sm text-gray-500">
          {loading && items.length === 0
            ? "Loading..."
            : dataset.type === "production"
              ? tagFilterActive
                ? `${visible.length} notes · all time, tagged${loadingLogs ? " · loading logs…" : ""}`
                : `${visible.length} notes · last ${windowDays} days${loadingLogs ? " · loading logs…" : ""}`
              : `${filtered.length} items shown`}
        </div>
        {firstRatedIndex > 0 && (
          <button
            onClick={scrollToFirstRated}
            className="text-xs px-2 py-0.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
          >
            Jump to first rated note ↓
          </button>
        )}
      </div>

      {/* Items */}
      <div className="space-y-3">
        {visible.map((item) => (
          <div key={item.id} id={`note-${item.id}`}>
            <NoteCard
              item={item}
              failureModeCatalog={activeFailureModes}
              failureModeUsage={tagCounts}
              showFixed={showFixedTags}
              onSeenToggle={handleSeenToggle}
              onFailureModesChange={handleFailureModesChange}
              onCreateFailureMode={handleCreateFailureMode}
              onCommentChange={handleCommentChange}
            />
          </div>
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
            {loading ? "Loading…" : `Load older notes (+${WINDOW_DAYS_STEP} days)`}
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
