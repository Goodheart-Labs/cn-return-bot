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
import { resolveRatingCounts } from "../../dashboard-shared/Ratings";
import { FULLY_LOADED_FAILURE_TYPES } from "../../dashboard-shared/productionView";
import {
  fetchDashboardData,
  fetchDefaultStatusData,
  fetchDashboardDataByTags,
  buildDashboardItems,
  fetchLogsForRuns,
  fetchProductionPillData,
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

// The WINDOWED (non-default) types are bounded by a date window on
// notes.submitted_at: the initial load covers the last WINDOW_DAYS_STEP days; the
// "Load next N days" footer extends it by another step. The standard selection is
// loaded in full (no window) — see fetchDefaultStatusData.
const WINDOW_DAYS_STEP = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Failure types whose pills show a seen-aware count (how many are left to review
// under the current seen filter) instead of the all-time total. Limited to the
// cn_status-derived categories we can classify from the lightweight pill data;
// the rest (needs-more-ratings, missed, low-eval) keep their all-time totals.
const SEEN_AWARE_FAILURE_TYPES: FailureType[] = ["rated_helpful", "rated_unhelpful", "lost_to_competitor"];

// The "standard selection" we load in full (no window); everything else is
// windowed. Used to decide whether the "Load next N days" footer has anything
// more to load. See productionView.FULLY_LOADED_FAILURE_TYPES.
const FULLY_LOADED = new Set<FailureType>(FULLY_LOADED_FAILURE_TYPES);

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

// Union two production item lists by id. `winners` overwrite `base` on overlap:
// the windowed fetch carries competing/missed/low-eval + in-window ab_test_picks,
// so it wins over the full-default rows; out-of-window default notes exist only in
// `base`, so they survive.
function mergeItemsById(base: ReviewItem[], winners: ReviewItem[]): ReviewItem[] {
  const byId = new Map(base.map((i) => [i.id, i]));
  for (const w of winners) byId.set(w.id, w);
  return [...byId.values()];
}

// Re-apply in-session annotation edits (you can only edit visible notes, all in
// `prev`) onto a freshly-fetched list, so a load landing mid-edit can't revert it.
function preserveAnnotations(prev: ReviewItem[], next: ReviewItem[]): ReviewItem[] {
  const prevAnn = new Map(prev.map((i) => [i.id, i.annotation]));
  return next.map((i) => {
    const edited = prevAnn.get(i.id);
    return edited ? { ...i, annotation: edited } : i;
  });
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
  // All-time {failureType, seen} per note and {failureModes, seen} per annotation,
  // so the rated/tag pills can show counts under the current seen filter (how many
  // are left to review) rather than the all-time total. Fetched with the counts.
  const [notesSeen, setNotesSeen] = useState<{ noteId: string; failureType: FailureType; seen: boolean; abTestPicks: Record<string, string> | null }[]>([]);
  const [annotationsSeen, setAnnotationsSeen] = useState<{ targetId: string; failureModes: string[]; seen: boolean; abTestPicks: Record<string, string> | null }[]>([]);
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
  // Date-window size for the WINDOWED (non-default) types, in days. Extends in
  // WINDOW_DAYS_STEP increments via the "Load next N days" footer. The standard
  // selection ignores this (loaded in full). Dataset runs ignore it too.
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

  // Monotonic id so a re-fire (dataset switch / window extend) that lands out of
  // order can't clobber the newer view: each setState is gated on it.
  const loadSeq = useRef(0);

  // Load data when the dataset / window / tag filter changes. Production is a
  // HYBRID: the standard selection (default-on types) is loaded in FULL — no
  // window — so it's always complete; everything else is windowed. Tag filtering
  // swaps both for an all-time fetch of everything tagged. Pill counts are all-time
  // (a separate effect). Dataset runs keep their one-shot fetch (already include logs).
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
        // Instant first paint: the server injects the FULL default set as
        // window.__DEFAULT_VIEW__. Paint it with zero round-trips, then reload.
        // Consumed once, so window extends and later reloads fetch fresh.
        const injected = (window as any).__DEFAULT_VIEW__;
        (window as any).__DEFAULT_VIEW__ = null;
        if (injected?.canonical?.length) {
          setItems(buildDashboardItems(injected));
          setLoading(false);
        }
        // The standard selection in full (no window, carries ab_test_picks via
        // submitted runs) UNIONed with the windowed everything-else. Windowed rows
        // win on id overlap (competing/missed/low-eval + in-window ab data);
        // out-of-window default notes survive; in-session annotation edits preserved.
        const windowSince = new Date(Date.now() - windowDays * MS_PER_DAY).toISOString();
        const [defaultData, windowData] = await Promise.all([
          fetchDefaultStatusData(),
          fetchDashboardData(windowSince),
        ]);
        if (seq !== loadSeq.current) return;
        const merged = mergeItemsById(buildDashboardItems(defaultData), buildDashboardItems(windowData));
        setItems((prev) => preserveAnnotations(prev, merged));
        setLogsByRunId(new Map());
      } else {
        const loaded = await fetchDatasetRunItems(dataset.id!);
        if (seq !== loadSeq.current) return;
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

  // Production pill data is all-time and independent of the date window, so fetch
  // it once per production session rather than on every window extension. One
  // pass returns the all-time counts plus the per-note / per-annotation seen
  // flags the seen-aware pills derive from.
  useEffect(() => {
    if (dataset.type !== "production") return;
    fetchProductionPillData()
      .then(({ counts, tagCounts, notesSeen, annotationsSeen }) => {
        setCounts(counts);
        setProductionTagCounts(tagCounts);
        setNotesSeen(notesSeen);
        setAnnotationsSeen(annotationsSeen);
      })
      .catch((e) => console.warn("Failed to fetch production pill data:", e));
  }, [dataset]);

  // Sort items by date (stable memo so renders don't re-sort unnecessarily).
  const sortedItems = useMemo(() => [...items].sort(byCreatedDesc), [items]);
  const filtered = sortedItems.filter(matchesFilters(filters, abFilters));

  // Loaded items keyed by id — their annotation state is the live truth and wins
  // over the all-time pill data below. You can only edit a visible note, so every
  // in-session seen/tag change is in here, which keeps the counts live without a
  // refetch (mark a note seen and the "left to review" count drops immediately).
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // True when any A/B slot is filtered. An empty A/B filter matches everything,
  // so the seen-aware counts already double as A/B-aware ones — we only need the
  // recompute when at least one of the seen / A/B filters is actually narrowing.
  const abActive = useMemo(() => Object.values(abFilters).some(Boolean), [abFilters]);

  // Seen- and A/B-aware production pill counts: for the rated categories the pills
  // report how many are left under the current seen + A/B filters, not the all-time
  // total. Based on all-time notesSeen (so the window doesn't undercount), with
  // loaded notes overridden by live state. No active filter → all-time counts.
  const displayCounts = useMemo(() => {
    if (dataset.type !== "production" || (filters.seen === "all" && !abActive)) return counts;
    const wantSeen = filters.seen === "seen";
    const derived = { ...counts };
    for (const ft of SEEN_AWARE_FAILURE_TYPES) derived[ft] = 0;
    for (const n of notesSeen) {
      if (!SEEN_AWARE_FAILURE_TYPES.includes(n.failureType)) continue;
      const live = itemById.get(n.noteId);
      const seen = live ? !!live.annotation?.seen : n.seen;
      const picks = live ? live.abTestPicks : n.abTestPicks;
      if (filters.seen !== "all" && seen !== wantSeen) continue;
      if (!matchesAbFilters(picks ?? null, abFilters)) continue;
      derived[n.failureType]++;
    }
    return derived;
  }, [dataset.type, counts, notesSeen, itemById, filters.seen, abFilters, abActive]);

  // Seen- and A/B-aware tag counts: same idea for the failure-mode pills. Merge by
  // id so loaded notes use their live annotation (tags added/removed this session).
  const displayTagCounts = useMemo(() => {
    if (dataset.type !== "production" || (filters.seen === "all" && !abActive)) return productionTagCounts;
    const wantSeen = filters.seen === "seen";
    const byId = new Map<string, { failureModes: string[]; seen: boolean; abTestPicks: Record<string, string> | null }>();
    for (const a of annotationsSeen) byId.set(a.targetId, { failureModes: a.failureModes, seen: a.seen, abTestPicks: a.abTestPicks });
    for (const i of items) byId.set(i.id, { failureModes: i.annotation?.failureModes ?? [], seen: !!i.annotation?.seen, abTestPicks: i.abTestPicks ?? null });
    const derived = new Map<string, number>();
    for (const { failureModes, seen, abTestPicks } of byId.values()) {
      if (filters.seen !== "all" && seen !== wantSeen) continue;
      if (!matchesAbFilters(abTestPicks ?? null, abFilters)) continue;
      for (const m of failureModes) derived.set(m, (derived.get(m) ?? 0) + 1);
    }
    return derived;
  }, [dataset.type, productionTagCounts, annotationsSeen, items, filters.seen, abFilters, abActive]);

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
  // Production items are only partially loaded (date window), so use the seen-aware
  // all-time counts there; deriving from items would undercount.
  const tagCounts = dataset.type === "production" ? displayTagCounts : itemTagCounts;

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
  // The "Load next N days" footer is relevant only when a WINDOWED (non-default)
  // type is selected — the standard selection is loaded in full, so there's nothing
  // more to load for it. Hidden under a tag filter (all-time) and for dataset runs.
  const windowedTypeSelected =
    dataset.type === "production" &&
    !tagFilterActive &&
    [...filters.failureTypes].some((ft) => !FULLY_LOADED.has(ft));

  // The boundary: the OLDEST loaded windowed note. Below it (older) only the
  // fully-loaded standard notes remain — that's where loading the next window
  // helps. Newest-first order means windowed notes (recent) cluster near the top.
  const lastWindowedId = useMemo(() => {
    for (let i = visible.length - 1; i >= 0; i--) {
      if (!FULLY_LOADED.has(visible[i].failureType)) return visible[i].id;
    }
    return null;
  }, [visible]);

  // Only surface the footer once you've scrolled PAST that boundary — the last
  // windowed note has left the top of the viewport, so only the fully-loaded
  // standard notes remain on screen (the user's "you're at week 2" case). Or
  // immediately if no windowed notes are loaded at all. A scroll listener (rAF-
  // throttled) rather than IntersectionObserver, which doesn't fire when you jump
  // straight past the boundary.
  const [scrolledPastWindow, setScrolledPastWindow] = useState(false);
  useEffect(() => {
    if (!windowedTypeSelected) { setScrolledPastWindow(false); return; }
    if (!lastWindowedId) { setScrolledPastWindow(true); return; }
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = document.getElementById(`note-${lastWindowedId}`);
      setScrolledPastWindow(!!el && el.getBoundingClientRect().bottom < 0);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [windowedTypeSelected, lastWindowedId]);

  const showLoadMore = windowedTypeSelected && scrolledPastWindow;

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

      {/* Item count + jump-to-rated */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-sm text-gray-500">
          {loading && items.length === 0
            ? "Loading..."
            : dataset.type === "production"
              ? tagFilterActive
                ? `${visible.length} notes · all time, tagged${loadingLogs ? " · loading logs…" : ""}`
                : `${visible.length} notes · standard selection + last ${windowDays} days${loadingLogs ? " · loading logs…" : ""}`
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

      {/* "Load next window" footer — pinned to the viewport bottom, shown once you
          scroll past the windowed notes into the standard-only region (only the
          fully-loaded default notes remain there). */}
      {showLoadMore && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 py-3 bg-white/95 backdrop-blur border-t border-gray-200 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Loading…" : `Load next ${WINDOW_DAYS_STEP} days (currently last ${windowDays} days)`}
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
