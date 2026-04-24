import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  fetchMissedBatch,
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
  // Production-only pagination state. Each "Load more" click advances the
  // canonical cursor and, when missed is enabled, the missed cursor too.
  const [dbOffset, setDbOffset] = useState(0);
  const [hasMoreInDb, setHasMoreInDb] = useState(true);
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_PAGE_SIZE);
  // Missed opportunities are paginated with their own cursor (sorted by
  // competing_notes.created_at_millis desc). Only advanced while the
  // missed_opportunity filter is on.
  const [missedOffset, setMissedOffset] = useState(0);
  const [hasMoreMissedInDb, setHasMoreMissedInDb] = useState(true);
  // Ref, not state: if this were state, setting it inside the effect would
  // change the dep array and cancel the in-flight fetch via the cleanup fn.
  const missedStartedRef = useRef(false);

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
        setMissedOffset(0);
        setHasMoreMissedInDb(true);
        missedStartedRef.current = false;
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

  // Fetch the first batch of missed opportunities the first time the filter
  // turns on. Subsequent batches are pulled by handleLoadMore alongside
  // canonical, so we never over-fetch the full set.
  useEffect(() => {
    if (dataset.type !== "production") return;
    if (!filters.failureTypes.has("missed_opportunity")) return;
    if (missedStartedRef.current) return;
    missedStartedRef.current = true;
    setLoadingMore(true);
    fetchMissedBatch(0, DB_BATCH_SIZE)
      .then((batch) => {
        setItems((prev) => {
          const existing = new Set(prev.map((i) => i.id));
          const add = batch.items.filter((m) => !existing.has(m.id));
          const merged = [...prev, ...add];
          setCounts(countsFromItems(merged));
          return merged;
        });
        setMissedOffset(batch.items.length);
        setHasMoreMissedInDb(batch.hasMore);
      })
      .finally(() => setLoadingMore(false));
  }, [dataset.type, filters.failureTypes]);

  // Sort here instead of inside every setItems so missed-opportunity merges
  // and canonical appends don't have to coordinate the ordering themselves.
  const sortedItems = useMemo(() => [...items].sort(byCreatedDesc), [items]);
  // Filter loaded items (cheap client-side filter covers cn_status-based
  // categories AND lost_to_competitor, which depends on competing_notes).
  const filtered = sortedItems.filter(matchesFilters(filters));

  const visible = dataset.type === "production" ? filtered.slice(0, displayLimit) : filtered;
  const missedEnabled = filters.failureTypes.has("missed_opportunity");
  const canLoadMore =
    dataset.type === "production" &&
    (hasMoreInDb || (missedEnabled && hasMoreMissedInDb) || filtered.length > displayLimit);

  const handleLoadMore = useCallback(async () => {
    if (dataset.type !== "production" || loadingMore) return;
    setLoadingMore(true);
    try {
      const targetFiltered = displayLimit + DISPLAY_PAGE_SIZE;
      let currentItems = items;
      let canonOffset = dbOffset;
      let canonHasMore = hasMoreInDb;
      let missOffset = missedOffset;
      let missHasMore = hasMoreMissedInDb;
      let currentFiltered = filtered.length;
      // Each click advances both cursors in parallel (when both are active).
      // First pass is unconditional so canonical keeps flowing in even after
      // missed is added; subsequent passes only fire if we're still short of
      // the display target, bounded so restrictive filters can't hammer the DB.
      const MAX_FETCHES_PER_CLICK = 5;
      let fetches = 0;
      const shouldFetchMore = () =>
        (canonHasMore || (missedEnabled && missHasMore)) &&
        fetches < MAX_FETCHES_PER_CLICK &&
        (fetches === 0 || currentFiltered < targetFiltered);
      while (shouldFetchMore()) {
        const calls: Promise<{ items: ReviewItem[]; hasMore: boolean }>[] = [];
        if (canonHasMore) calls.push(fetchCanonicalBatch(canonOffset, DB_BATCH_SIZE));
        if (missedEnabled && missHasMore) calls.push(fetchMissedBatch(missOffset, DB_BATCH_SIZE));
        const results = await Promise.all(calls);
        let idx = 0;
        if (canonHasMore) {
          const canonBatch = results[idx++];
          currentItems = [...currentItems, ...canonBatch.items];
          canonOffset += canonBatch.items.length;
          canonHasMore = canonBatch.hasMore;
        }
        if (missedEnabled && missHasMore) {
          const missBatch = results[idx++];
          const existing = new Set(currentItems.map((i) => i.id));
          const add = missBatch.items.filter((m) => !existing.has(m.id));
          currentItems = [...currentItems, ...add];
          missOffset += missBatch.items.length;
          missHasMore = missBatch.hasMore;
        }
        currentFiltered = currentItems.filter(matchesFilters(filters)).length;
        fetches++;
      }
      setItems(currentItems);
      setDbOffset(canonOffset);
      setHasMoreInDb(canonHasMore);
      setMissedOffset(missOffset);
      setHasMoreMissedInDb(missHasMore);
      setCounts(countsFromItems(currentItems));
      setDisplayLimit(targetFiltered);
    } catch (err: any) {
      console.error("Load more failed:", err);
      setError(err?.message ?? "Load more failed");
    } finally {
      setLoadingMore(false);
    }
  }, [dataset.type, loadingMore, displayLimit, items, dbOffset, hasMoreInDb, missedOffset, hasMoreMissedInDb, missedEnabled, filtered.length, filters]);

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
