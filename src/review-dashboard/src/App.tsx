import { useState, useEffect, useMemo, useCallback } from "react";
import type {
  ReviewItem,
  DatasetOption,
  FilterState,
  FailureType,
  UploadInfo,
} from "./lib/types";
import { FAILURE_TYPE_CONFIG } from "./lib/types";
import {
  fetchCanonicalBatch,
  fetchMissedOpportunities,
  countsFromItems,
  fetchDatasetRunItems,
  fetchDatasetRunCounts,
  fetchUploads,
  fetchFailureModes,
  upsertAnnotation,
  createFailureMode,
  deleteUpload,
  pruneUnusedFailureModes,
  DB_BATCH_SIZE,
} from "./lib/data";

const DISPLAY_PAGE_SIZE = 20;
import { NoteCard } from "./components/NoteCard";
import { FilterBar } from "./components/FilterBar";
import { DatasetSelector } from "./components/DatasetSelector";
import { UploadDialog } from "./components/UploadDialog";

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

function matchesFilters(filters: FilterState) {
  return (item: ReviewItem) => {
    if (!filters.failureTypes.has(item.failureType)) return false;
    if (filters.seen === "seen" && !(item.annotation?.seen)) return false;
    if (filters.seen === "unseen" && item.annotation?.seen) return false;
    if (filters.failureModes.size > 0) {
      const itemModes = item.annotation?.failureModes ?? [];
      if (!itemModes.some((m) => filters.failureModes.has(m))) return false;
    }
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
  const [counts, setCounts] = useState<Record<FailureType, number>>({} as any);
  const [failureModeCatalog, setFailureModeCatalog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Production-only pagination state. Each "Load more" click triggers
  // additional DB batches until we have DISPLAY_PAGE_SIZE more filtered items.
  const [dbOffset, setDbOffset] = useState(0);
  const [hasMoreInDb, setHasMoreInDb] = useState(true);
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_PAGE_SIZE);
  const [missedLoaded, setMissedLoaded] = useState(false);

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

  // Load data when dataset changes. For production we fetch one DB batch
  // up-front and rely on "Load more" to paginate; for dataset runs we still
  // fetch everything (bounded set).
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (dataset.type === "production") {
        const batch = await fetchCanonicalBatch(0, DB_BATCH_SIZE);
        setItems(batch.items);
        setDbOffset(batch.items.length);
        setHasMoreInDb(batch.hasMore);
        setDisplayLimit(DISPLAY_PAGE_SIZE);
        setMissedLoaded(false);
        setCounts(countsFromItems(batch.items));
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
  }, [dataset]);

  useEffect(() => {
    setFilters(defaultFilters(dataset.type));
    loadData();
  }, [dataset]);

  // Lazy-load the missed-opportunity set the first time it's enabled. The set
  // is bounded (helpful competing notes on rejected tweets) so one fetch is OK.
  useEffect(() => {
    if (dataset.type !== "production") return;
    if (!filters.failureTypes.has("missed_opportunity")) return;
    if (missedLoaded) return;
    let cancelled = false;
    setLoadingMore(true);
    fetchMissedOpportunities()
      .then((missed) => {
        if (cancelled) return;
        setItems((prev) => {
          const existing = new Set(prev.map((i) => i.id));
          const add = missed.filter((m) => !existing.has(m.id));
          const merged = [...prev, ...add];
          // Refresh counts — countsFromItems is cheap and the badge was
          // showing 0 for missed until the next Load-more click otherwise.
          setCounts(countsFromItems(merged));
          return merged;
        });
        setMissedLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingMore(false);
      });
    return () => { cancelled = true; };
  }, [dataset.type, filters.failureTypes, missedLoaded]);

  // Sort here instead of inside every setItems so missed-opportunity merges
  // and canonical appends don't have to coordinate the ordering themselves.
  const sortedItems = useMemo(() => [...items].sort(byCreatedDesc), [items]);
  // Filter loaded items (cheap client-side filter covers cn_status-based
  // categories AND lost_to_competitor, which depends on competing_notes).
  const filtered = sortedItems.filter(matchesFilters(filters));

  const visible = dataset.type === "production" ? filtered.slice(0, displayLimit) : filtered;
  const canLoadMore = dataset.type === "production" && (hasMoreInDb || filtered.length > displayLimit);

  const handleLoadMore = useCallback(async () => {
    if (dataset.type !== "production" || loadingMore) return;
    setLoadingMore(true);
    try {
      const targetFiltered = displayLimit + DISPLAY_PAGE_SIZE;
      let currentItems = items;
      let currentOffset = dbOffset;
      let currentHasMore = hasMoreInDb;
      let currentFiltered = filtered.length;
      // Always pull at least one more canonical batch per click (if DB has more).
      // Without this, once missed-opportunities are loaded `filtered.length` can
      // already exceed the target and the loop skips, so scrolling would only
      // surface the missed set without ever fetching newer canonical pages.
      const MAX_FETCHES_PER_CLICK = 5;
      let fetches = 0;
      const shouldFetchMore = () =>
        currentHasMore &&
        fetches < MAX_FETCHES_PER_CLICK &&
        (fetches === 0 || currentFiltered < targetFiltered);
      while (shouldFetchMore()) {
        const batch = await fetchCanonicalBatch(currentOffset, DB_BATCH_SIZE);
        currentItems = [...currentItems, ...batch.items];
        currentOffset += batch.items.length;
        currentHasMore = batch.hasMore;
        currentFiltered = currentItems.filter(matchesFilters(filters)).length;
        fetches++;
      }
      setItems(currentItems);
      setDbOffset(currentOffset);
      setHasMoreInDb(currentHasMore);
      setCounts(countsFromItems(currentItems));
      setDisplayLimit(targetFiltered);
    } catch (err: any) {
      console.error("Load more failed:", err);
      setError(err?.message ?? "Load more failed");
    } finally {
      setLoadingMore(false);
    }
  }, [dataset.type, loadingMore, displayLimit, items, dbOffset, hasMoreInDb, filtered.length, filters]);

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
      setFailureModeCatalog((prev) =>
        prev.includes(name) ? prev : [...prev, name].sort(),
      );
    } catch (err: any) {
      console.error("Failed to create failure mode:", err);
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

      {/* Failure mode filter pills */}
      {failureModeCatalog.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {failureModeCatalog.map((mode) => {
            const active = filters.failureModes.has(mode);
            return (
              <button
                key={mode}
                onClick={() => {
                  const next = new Set(filters.failureModes);
                  if (active) next.delete(mode);
                  else next.add(mode);
                  setFilters({ ...filters, failureModes: next });
                }}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  active
                    ? "bg-purple-100 text-purple-800 border-purple-300"
                    : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                }`}
              >
                {mode}
              </button>
            );
          })}
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
            ? `Showing ${visible.length} of ${filtered.length}${canLoadMore ? "+" : ""}`
            : `${filtered.length} items shown`}
      </div>

      {/* Items */}
      <div className="space-y-3">
        {visible.map((item) => (
          <NoteCard
            key={item.id}
            item={item}
            failureModeCatalog={failureModeCatalog}
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
            disabled={loadingMore}
            className="px-4 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? "Loading..." : `Load more (${DISPLAY_PAGE_SIZE})`}
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
