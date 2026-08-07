import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { PostingLimitDrawer } from "./components/PostingLimitDrawer";
import type {
  ReviewItem,
  DatasetOption,
  FilterState,
  FailureType,
  UploadInfo,
  FailureModeInfo,
} from "./lib/types";
import { defaultFilters } from "./lib/types";
import { resolveRatingCounts } from "../../dashboard-shared/Ratings";
import {
  compileFilters,
  fetchDashboardPage,
  fetchDashboardCounts,
  fetchLogsForRuns,
  fetchDatasetRunItems,
  fetchDatasetRunCounts,
  fetchUploads,
  fetchFailureModes,
  upsertAnnotation,
  createFailureMode,
  setFailureModeFixed,
  deleteUpload,
  pruneUnusedFailureModes,
  type PageCursor,
  type DashboardCounts,
} from "./lib/data";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Failure types whose pills show a seen-aware count (how many are left to review
// under the current seen filter) instead of the all-time total. Limited to the
// cn_status-derived categories we can classify from the lightweight pill data;
// the rest (needs-more-ratings, missed, low-eval) keep their all-time totals.
const SEEN_AWARE_FAILURE_TYPES: FailureType[] = ["rated_helpful", "rated_unhelpful", "lost_to_competitor"];

// Burn-down: the review backlog you're clearing to zero — unseen rated + underwater
// notes (deliberately NOT the fresh NEEDS_MORE_RATINGS ones: "I couldn't do all").
// Fixed target date so hitting the daily quota is a real "done for today". Edit the
// date to re-aim.
const BURNDOWN_TYPES = new Set<FailureType>(["rated_helpful", "rated_unhelpful", "underwater"]);
const BURNDOWN_TARGET_ISO = "2026-10-18";
// Nathan rates in bursts, not daily — quota assumes this many rating-days per
// week (Nathan, 2026-08-06: "assume I rate 4 days a week, set the rate for that").
const RATING_DAYS_PER_WEEK = 4;

// Stale-while-revalidate cache for the tag catalog, so the tags drawer paints
// instantly from the last session's snapshot.
const CATALOG_CACHE_KEY = "reviewDashboard.catalogCache.v1";

function daysUntil(iso: string): number {
  const ms = new Date(iso + "T23:59:59").getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

// Top-of-page pace bar: how many of the review backlog to clear today to stay on
// track for BURNDOWN_TARGET_ISO, going green when you've done enough. The daily
// quota is anchored to the day's STARTING unseen count (persisted per-day in
// localStorage) so it doesn't shrink out from under you as you rate — that's what
// makes "done today" a fixed, hittable bar.
function BurndownBar({ unseen, reviewedToday, ready, inflowPerDay, pacePerDay }: { unseen: number; reviewedToday: number; ready: boolean; inflowPerDay: number; pacePerDay: number }) {
  const todayKey = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const [dayStart, setDayStart] = useState<number | null>(null);
  // "at this rate" explainer, toggled by clicking the projection text.
  const [explainOpen, setExplainOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(`reviewDashboard.burndown.dismissed.${new Date().toLocaleDateString("en-CA")}`) === "true"; }
    catch { return false; }
  });
  useEffect(() => {
    if (!ready) return;
    const k = `reviewDashboard.burndown.dayStart.${todayKey}`;
    try {
      const saved = localStorage.getItem(k);
      if (saved != null) { setDayStart(Number(saved)); return; }
      localStorage.setItem(k, String(unseen));
    } catch { /* ignore */ }
    setDayStart(unseen);
    // Capture the day's baseline once, when data is first ready — used only to set
    // the day's quota. Progress is the reviewedToday COUNTER (below), not the drop
    // in unseen — so notes the bot writes during the day can't mask your progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, todayKey]);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(`reviewDashboard.burndown.dismissed.${todayKey}`, "true"); } catch { /* ignore */ }
  };

  if (!ready || dayStart == null || dismissed) return null;
  const daysLeft = daysUntil(BURNDOWN_TARGET_ISO);
  // Quota = what a RATING DAY must clear to hit the target, assuming
  // RATING_DAYS_PER_WEEK rating-days a week: total remaining work (backlog +
  // inflow over ALL remaining calendar days) spread over the remaining
  // rating-days only. Recomputed daily from live state, so slipping raises it
  // and getting ahead lowers it.
  const ratingDaysLeft = Math.max(1, daysLeft * (RATING_DAYS_PER_WEEK / 7));
  const quota = Math.max(1, Math.ceil((dayStart + inflowPerDay * daysLeft) / ratingDaysLeft));
  const progress = reviewedToday; // notes YOU marked seen today — inflow-proof
  const done = progress >= quota;
  const remainingToday = Math.max(0, quota - progress);
  // Full + green the moment the day's quota is met; the count keeps ticking up
  // past it (progress rises) while the bar stays full.
  const pct = done ? 100 : Math.min(100, Math.round((progress / quota) * 100));
  const targetLabel = new Date(BURNDOWN_TARGET_ISO + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // Reality check: at the observed 14-day pace, net of inflow, when does the
  // pile actually hit zero? Diverges (or regresses) → "not at this pace".
  const netPerDay = pacePerDay - inflowPerDay;
  let projectedLabel: string;
  if (netPerDay <= 0.05) {
    projectedLabel = "not at this pace";
  } else {
    const projected = new Date(Date.now() + (unseen / netPerDay) * MS_PER_DAY);
    projectedLabel = projected.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(projected.getFullYear() !== new Date().getFullYear() ? { year: "2-digit" } : {}),
    });
  }
  const onTrack = projectedLabel !== "not at this pace" && Date.now() + (unseen / Math.max(netPerDay, 0.05)) * MS_PER_DAY <= new Date(BURNDOWN_TARGET_ISO + "T23:59:59").getTime();

  return (
    <div className={`relative mb-4 rounded-lg border p-3 ${done ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
      <button
        onClick={dismiss}
        title="Dismiss for today"
        aria-label="Dismiss for today"
        className="absolute top-1 right-2 text-gray-400 hover:text-gray-600 text-base leading-none"
      >
        ×
      </button>
      <div className="flex items-center justify-between text-sm pr-5">
        <span className={done ? "text-green-800 font-medium" : "text-gray-700 font-medium"}>
          {done
            ? `✓ Done for today — ${progress} reviewed`
            : `Review ${remainingToday} more today (${progress}/${quota})`}
        </span>
        <span className="text-xs text-gray-500">
          {unseen} unseen · target {targetLabel} ·{" "}
          <button
            onClick={() => setExplainOpen((o) => !o)}
            className={`${onTrack ? "text-green-600" : "text-amber-600"} underline decoration-dotted cursor-help`}
            title="What does this mean?"
          >
            at this rate: {projectedLabel}
          </button>
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full transition-all duration-300 ${done ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
      </div>
      {explainOpen && (
        <div className="mt-2 text-xs text-gray-500 leading-relaxed">
          <b>"At this rate"</b> = your average reviewing speed over the last 14 days ({pacePerDay.toFixed(1)}/day,
          zero-days included) minus new notes joining the pile as they get rated (~{inflowPerDay.toFixed(1)}/day,
          estimated from the matured 14–44-day cohort). Net ≈ {Math.max(0, pacePerDay - inflowPerDay).toFixed(1)}/day
          of real shrinkage on {unseen} unseen → zero around <b>{projectedLabel}</b>. If the next months look like the
          last two weeks, that's when you finish; review more days per week and this date marches toward the{" "}
          {targetLabel} target (it turns green when it crosses). Today's quota ({quota}) assumes you rate {RATING_DAYS_PER_WEEK} days a
          week: all remaining work (backlog + inflow to the target) ÷ remaining rating-days.
        </div>
      )}
    </div>
  );
}

import { NoteCard } from "./components/NoteCard";
import { FilterBar } from "./components/FilterBar";
import { DatasetSelector } from "./components/DatasetSelector";
import { UploadDialog } from "./components/UploadDialog";
import { AbFilterPanel } from "../../dashboard-shared/AbFilterPanel";
import {
  buildAbTestSlots,
  type ABFilters,
} from "../../dashboard-shared/abFilters";
import { topicSetFor } from "../../dashboard-shared/topicSets";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";


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

// Production filtering happens server-side (compileFilters → the page RPC).
// Dataset-run items are fully loaded client-side, so they keep a local
// predicate: the tag lens when tags are selected, else pills + seen.
function matchesDatasetFilters(filters: FilterState) {
  return (item: ReviewItem) => {
    if (filters.failureModes.size > 0) {
      const itemModes = item.annotation?.failureModes ?? [];
      return itemModes.some((m) => filters.failureModes.has(m));
    }
    if (filters.failureTypes.size > 0 && !filters.failureTypes.has(item.failureType)) return false;
    if (filters.seen === "seen" && !(item.annotation?.seen)) return false;
    if (filters.seen === "unseen" && item.annotation?.seen) return false;
    return true;
  };
}

function initialDatasetFromUrl(): DatasetOption {
  if (typeof window === "undefined") return { type: "production", name: "Production" };
  const uploadId = new URLSearchParams(window.location.search).get("upload");
  if (uploadId) return { type: "dataset_run", id: uploadId, name: uploadId };
  return { type: "production", name: "Production" };
}

// Persist the production filter selection across refreshes so a reload doesn't
// snap back to defaults (Nathan, 2026-07-15). Sets don't survive JSON, so we
// round-trip them through arrays. Scoped to production — dataset-run filters are
// short-lived and keyed to a specific run.
const FILTERS_KEY = "reviewDashboard.filters.production";
const SHOW_TAGS_KEY = "reviewDashboard.showTags";

function serializeFilters(f: FilterState): string {
  return JSON.stringify({
    seen: f.seen,
    failureTypes: [...f.failureTypes],
    failureModes: [...f.failureModes],
    topicSets: [...f.topicSets],
    highValueOnly: f.highValueOnly,
  });
}

function loadSavedFilters(): FilterState | null {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      seen: o.seen ?? "unseen",
      failureTypes: new Set(o.failureTypes ?? []),
      failureModes: new Set(o.failureModes ?? []),
      topicSets: new Set(o.topicSets ?? []),
      highValueOnly: !!o.highValueOnly,
    };
  } catch {
    return null;
  }
}

export function App() {
  const [dataset, setDataset] = useState<DatasetOption>(initialDatasetFromUrl);
  const [uploads, setUploads] = useState<UploadInfo[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filters, setFilters] = useState<FilterState>(() => {
    // Restore the saved production selection on load; first-ever visit falls back
    // to defaults (which now include Underwater). NB initialDatasetFromUrl is a
    // function — must be CALLED, not read as `.type`.
    const initial = initialDatasetFromUrl();
    if (initial.type === "production") {
      const saved = loadSavedFilters();
      if (saved) return saved;
    }
    return defaultFilters(initial.type);
  });
  // Per-note failure-mode tag chips are hidden by default (Nathan finds them
  // cluttering); the editor dropdown still shows/edits them. Toggle persists.
  const [showTags, setShowTags] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHOW_TAGS_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [abFilters, setAbFilters] = useState<ABFilters>({});
  // A/B filter section is collapsed by default (its slots stream in as data loads).
  const [abOpen, setAbOpen] = useState(false);
  // Failure-mode tags drawer — collapsed by default so the big pill row doesn't
  // clutter the top (same collapsible style as the A/B test filters section).
  const [tagsOpen, setTagsOpen] = useState(false);
  // Dataset-run pill counts (production counts come from the counts RPC below).
  const [counts, setCounts] = useState<Record<FailureType, number>>({} as any);
  // Server-computed production aggregates: pill counts (all-time / unseen /
  // seen+A/B-filtered), tag counts, burndown inputs, A/B slot variants, topic
  // counts. Adjusted optimistically on annotation edits, reconciled by a
  // debounced refetch.
  const [countsData, setCountsData] = useState<DashboardCounts | null>(null);
  const [failureModeCatalog, setFailureModeCatalog] = useState<FailureModeInfo[]>([]);
  const [showFixedTags, setShowFixedTags] = useState(false);
  const [loading, setLoading] = useState(true);
  // Seen-toggles made THIS page session — added to the DB-derived count below,
  // then SUBTRACTED again once a fresh counts payload (which includes those
  // toggles' annotations) lands, so a toggle is never counted twice. The ref
  // mirrors the state so the async counts fetches can read the value at fetch
  // start without re-running on every bump.
  const [sessionSeenBumps, setSessionSeenBumps] = useState(0);
  const sessionSeenBumpsRef = useRef(0);
  const bumpReviewedToday = useCallback((delta: number) => {
    sessionSeenBumpsRef.current += delta;
    setSessionSeenBumps((n) => n + delta);
  }, []);
  const absorbSeenBumps = useCallback((bumpsAtFetchStart: number) => {
    sessionSeenBumpsRef.current -= bumpsAtFetchStart;
    setSessionSeenBumps((n) => n - bumpsAtFetchStart);
  }, []);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyset cursor for the next production page (null = no more pages) and the
  // server's total match count for the current filters.
  const [nextCursor, setNextCursor] = useState<PageCursor | null>(null);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Production: all items in the current date window are loaded up-front
  // (metadata only, no TOAST). Logs are lazy-loaded per visible card and cached
  // here keyed by pipeline_run id.
  const [logsByRunId, setLogsByRunId] = useState<Map<string, Record<string, unknown>>>(new Map());
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
    try {
      const raw = localStorage.getItem(CATALOG_CACHE_KEY);
      if (raw) setFailureModeCatalog(JSON.parse(raw));
    } catch { /* corrupt cache — fresh fetch below overwrites it */ }
    fetchFailureModes()
      .then((modes) => {
        setFailureModeCatalog(modes);
        try { localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(modes)); } catch { /* ignore */ }
      })
      .catch((e) => console.warn("Failed to fetch failure modes (table may not exist yet):", e));
  }, []);

  // The compiled server-side filters. Serialized so the fetch effect's dep is
  // stable (the FilterState Sets' identities churn on unrelated re-renders).
  const pageFilters = useMemo(
    () => (dataset.type === "production" ? compileFilters(filters, abFilters) : null),
    [dataset.type, filters, abFilters],
  );
  const filterKey = useMemo(() => JSON.stringify(pageFilters), [pageFilters]);
  // The counts RPC only reads {seen, ab}; keying its effect on this narrower
  // string means pill clicks don't refetch counts, only seen/A-B changes do.
  const countsKey = useMemo(
    () => JSON.stringify({ seen: pageFilters?.seen, ab: pageFilters?.ab }),
    [pageFilters],
  );

  // Monotonic id so a re-fire (dataset/filter switch) that lands out of order
  // can't clobber the newer view: each setState is gated on it.
  const loadSeq = useRef(0);

  // Load page 1 whenever the dataset or any server-side filter changes.
  // Production fetches one server-joined page; scrolling appends more via
  // loadMore. Dataset runs keep their one-shot fetch (items include logs).
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      if (dataset.type === "production") {
        const page = await fetchDashboardPage(pageFilters!, null);
        if (seq !== loadSeq.current) return;
        setItems((prev) => preserveAnnotations(prev, page.items));
        setNextCursor(page.nextCursor);
        setTotalItems(page.totalItems);
        setLogsByRunId(new Map());
      } else {
        const loaded = await fetchDatasetRunItems(dataset.id!);
        if (seq !== loadSeq.current) return;
        setItems(loaded);
        setNextCursor(null);
        setTotalItems(null);
        setCounts(await fetchDatasetRunCounts(dataset.id!));
      }
    } catch (err: any) {
      console.error("Failed to load data:", err);
      if (seq === loadSeq.current) setError(err?.message ?? "Failed to load data");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
    // filterKey is the stable proxy for pageFilters (read above).
  }, [dataset, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Append the next page when the scroll sentinel comes into view.
  const loadMore = useCallback(async () => {
    // `loading` bail: while page 1 of a new filter set is in flight, the cursor
    // still points into the OLD result set — following it would fetch a page of
    // the wrong list.
    if (dataset.type !== "production" || !nextCursor || loadingMore || loading) return;
    const seq = loadSeq.current;
    setLoadingMore(true);
    try {
      const page = await fetchDashboardPage(pageFilters!, nextCursor);
      if (seq !== loadSeq.current) return;
      setItems((prev) => {
        const known = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !known.has(i.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err: any) {
      console.error("Failed to load next page:", err);
      if (seq === loadSeq.current) setError(err?.message ?? "Failed to load next page");
    } finally {
      setLoadingMore(false);
    }
  }, [dataset.type, nextCursor, loadingMore, loading, pageFilters]);

  // Reset filters when the dataset changes (but not when only the window
  // extends — extending should preserve the user's filters). windowDays
  // intentionally persists across dataset switches; resetting it here would
  // re-fire loadData a second time on every switch. Skip the mount run so a
  // refresh keeps the restored/persisted selection instead of snapping to
  // defaults.
  const didMountReset = useRef(false);
  useEffect(() => {
    if (!didMountReset.current) {
      didMountReset.current = true;
      return;
    }
    setFilters(defaultFilters(dataset.type));
    setAbFilters({});
  }, [dataset]);

  // Persist the production filter selection + tag visibility across refreshes.
  useEffect(() => {
    if (dataset.type !== "production") return;
    try {
      localStorage.setItem(FILTERS_KEY, serializeFilters(filters));
    } catch {
      /* ignore */
    }
  }, [filters, dataset.type]);
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_TAGS_KEY, String(showTags));
    } catch {
      /* ignore */
    }
  }, [showTags]);

  // Load whenever the dataset or the window changes. loadData is memoized on
  // both, so this fires once per meaningful change.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Server-computed production aggregates (pill/tag/burndown/A-B counts).
  // Refetched only when the seen or A/B filters change — pill clicks reuse the
  // last payload. ~250ms server-side, so no client cache needed.
  useEffect(() => {
    if (dataset.type !== "production" || !pageFilters) return;
    const seq = loadSeq.current;
    const bumpsAtStart = sessionSeenBumpsRef.current;
    fetchDashboardCounts(pageFilters)
      .then((c) => {
        if (seq !== loadSeq.current) return;
        setCountsData(c);
        absorbSeenBumps(bumpsAtStart);
      })
      .catch((e) => {
        console.error("Failed to fetch counts:", e);
        if (seq === loadSeq.current) setError(e?.message ?? "Failed to fetch counts");
      });
    // countsKey is the stable proxy for the {seen, ab} slice of pageFilters.
  }, [dataset.type, countsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Annotation edits adjust countsData optimistically (below); this reconciles
  // with the server after the burst of clicks settles.
  const countsReconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCountsReconcile = useCallback(() => {
    if (countsReconcileTimer.current) clearTimeout(countsReconcileTimer.current);
    const seq = loadSeq.current;
    const f = pageFilters;
    if (!f) return;
    countsReconcileTimer.current = setTimeout(() => {
      const bumpsAtStart = sessionSeenBumpsRef.current;
      fetchDashboardCounts(f)
        .then((c) => {
          if (seq !== loadSeq.current) return;
          setCountsData(c);
          absorbSeenBumps(bumpsAtStart);
        })
        .catch((e) => console.error("Counts reconcile failed:", e));
    }, 2000);
  }, [pageFilters, absorbSeenBumps]);

  // Production items arrive server-sorted and server-filtered; the only live
  // client-side narrowing is the seen re-filter below (so marking a card seen in
  // "unseen" mode hides it instantly, without a refetch). Dataset-run items are
  // fully loaded and keep their client-side sort + filter.
  const filtered = useMemo(() => {
    if (dataset.type !== "production") {
      return [...items].sort(byCreatedDesc).filter(matchesDatasetFilters(filters));
    }
    const wantSeen = pageFilters?.seen;
    if (wantSeen === undefined) return items;
    return items.filter((i) => !!i.annotation?.seen === wantSeen);
  }, [dataset.type, items, filters, pageFilters]);

  // How many items sit in each topic set, for the topic-set filter chips —
  // folded from the server's per-topic counts (the topic → set grouping is TS).
  const topicSetCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of countsData?.topicCounts ?? []) {
      const set = topicSetFor(t.topic);
      if (set) c[set] = (c[set] ?? 0) + t.count;
    }
    return c;
  }, [countsData]);

  // Burn-down backlog: unseen rated + underwater notes, all-time, from the
  // counts RPC — optimistically decremented as you mark notes seen.
  const burndownUnseen = useMemo(() => {
    let n = 0;
    for (const row of countsData?.byFailureType ?? []) {
      if (BURNDOWN_TYPES.has(row.failureType)) n += row.unseen;
    }
    return n;
  }, [countsData]);

  // Inflow into the burndown pile (notes/day newly becoming rated/underwater).
  // Status-change dates aren't stored, so proxy with a matured cohort: burndown
  // notes SUBMITTED 14-44 days ago (old enough that most of their ratings have
  // arrived) over that 30-day span. Undercounts slightly while posting volume is
  // ramping, but it's data-driven and self-corrects as cohorts mature.
  const burndownInflowPerDay = useMemo(() => {
    let n = 0;
    for (const row of countsData?.byFailureType ?? []) {
      if (BURNDOWN_TYPES.has(row.failureType)) n += row.matured30d;
    }
    return n / 30;
  }, [countsData]);

  // Nathan's actual recent review pace: seen-annotations toggled in the last 14
  // days (updated_at moves on any edit, so this can over-count slightly if old
  // reviews get re-touched — acceptable for a pace estimate).
  const reviewPacePerDay = useMemo(() => {
    const cutoff = Date.now() - 14 * 86400000;
    return (countsData?.seenAnnotationTimes ?? []).filter((t) => Date.parse(t) >= cutoff).length / 14;
  }, [countsData]);

  // "Done today" from the DB: seen-annotations whose updated_at falls on today's
  // LOCAL date, plus toggles made this session (which aren't in the fetched
  // snapshot yet). Survives refreshes, other builds, other browsers.
  const reviewedToday = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
    const n = (countsData?.seenAnnotationTimes ?? []).filter(
      (t) => new Date(t).toLocaleDateString("en-CA") === today,
    ).length;
    return Math.max(0, n + sessionSeenBumps);
  }, [countsData, sessionSeenBumps]);

  // True when any A/B slot is filtered. The counts RPC's `current` column is
  // seen+A/B-aware; we only swap it in when one of those is actually narrowing.
  const abActive = useMemo(() => Object.values(abFilters).some(Boolean), [abFilters]);
  const abActiveCount = useMemo(() => Object.values(abFilters).filter(Boolean).length, [abFilters]);

  // Production pill counts: all-time totals, except the rated categories which
  // report how many are left under the current seen + A/B filters (`current`).
  const displayCounts = useMemo(() => {
    if (dataset.type !== "production") return counts;
    const narrowing = filters.seen !== "all" || abActive;
    const derived = {} as Record<FailureType, number>;
    for (const row of countsData?.byFailureType ?? []) {
      derived[row.failureType] =
        narrowing && SEEN_AWARE_FAILURE_TYPES.includes(row.failureType) ? row.current : row.total;
    }
    return derived;
  }, [dataset.type, counts, countsData, filters.seen, abActive]);

  // Tag counts, same idea: all-time totals unless seen/A-B narrows.
  const productionTagCounts = useMemo(() => {
    const narrowing = filters.seen !== "all" || abActive;
    return new Map(
      (countsData?.tagCounts ?? []).map((t) => [t.tag, narrowing ? t.current : t.total]),
    );
  }, [countsData, filters.seen, abActive]);
  const productionTagOrderCounts = useMemo(
    () => new Map((countsData?.tagCounts ?? []).map((t) => [t.tag, t.total])),
    [countsData],
  );
  const productionTagCounts30d = useMemo(
    () => new Map((countsData?.tagCounts ?? []).map((t) => [t.tag, t.last30d])),
    [countsData],
  );

  // A/B slots from the server's per-(slot, variant) aggregates; sort by AB_TESTS
  // declaration order so dropdowns match the stats dashboard layout. The latest
  // pick date drives the "recently varied" flag the panel uses to hide dormant
  // tests by default.
  const abSlots = useMemo(
    () =>
      buildAbTestSlots(
        (countsData?.abVariants ?? []).map((v) => ({ picks: { [v.slot]: v.variant }, at: v.lastPickedAt })),
        AB_TESTS,
      ),
    [countsData],
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
  // Production items are only partially loaded (one page at a time), so use the
  // server's all-time counts there; deriving from items would undercount.
  const tagCounts = dataset.type === "production" ? productionTagCounts : itemTagCounts;
  // Tag ORDER uses ALL-TIME usage, not the seen/filter-adjusted counts — so the
  // tag list keeps a stable, meaningful order instead of reshuffling as you filter
  // (Nathan, 2026-07-21). The little count shown on each chip still reflects the
  // current view (tagCounts); only the sort key is all-time.
  const tagOrderCounts = dataset.type === "production" ? productionTagOrderCounts : itemTagCounts;
  // The per-card selector dropdown sorts by LAST-30-DAYS usage instead (Nathan,
  // 2026-07-28: current-view counts made the order reshuffle with every filter;
  // 30d tracks what's going wrong now, so retired failure modes sink).
  const cardSelectorCounts = dataset.type === "production" ? productionTagCounts30d : itemTagCounts;

  const sortedFailureModes = useMemo(() => {
    const list = showFixedTags ? failureModeCatalog : failureModeCatalog.filter((m) => !m.fixed);
    return [...list].sort((a, b) => {
      const ca = tagOrderCounts.get(a.name) ?? 0;
      const cb = tagOrderCounts.get(b.name) ?? 0;
      if (cb !== ca) return cb - ca;
      return a.name.localeCompare(b.name);
    });
  }, [failureModeCatalog, tagOrderCounts, showFixedTags]);

  const activeFailureModes = useMemo(
    () => failureModeCatalog.filter((m) => !m.fixed),
    [failureModeCatalog],
  );

  // Fold lazy-loaded logs into the items the list is about to render. Without
  // this, the first render sees logs=undefined; once requestLogs fills
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

  // Infinite scroll: fetch the next server page when the user nears the bottom.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const nearBottom = () =>
    window.innerHeight + window.scrollY >= document.body.offsetHeight - 1200;
  useEffect(() => {
    const onScroll = () => {
      if (nearBottom()) loadMoreRef.current();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Scroll events only fire on movement — a user PARKED at the bottom (or a list
  // too short to scroll at all) never emits one. Re-check the position after
  // every append/filter/fetch-state change and keep chaining pages until the
  // content outruns the threshold or the cursor runs out.
  useEffect(() => {
    if (nearBottom()) loadMoreRef.current();
  }, [visible.length, nextCursor, loadingMore, loading]);

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

  // Fetch one run's logs on demand — when a card's log panel is expanded. The
  // log panel is collapsed by default, so eager-loading every visible card meant
  // pulling tens of MB of TOASTed JSONB up front (one slow/failed batch wiped
  // logs for the whole page). Now we pay the TOAST cost only for the card the
  // user actually opens. Dataset-run items carry logs inline, so they never call
  // this. Cached in logsByRunId so re-expanding is instant.
  const requestLogs = useCallback(async (runId: string) => {
    try {
      const fetched = await fetchLogsForRuns([runId]);
      const logs = fetched.get(runId);
      if (logs) setLogsByRunId((prev) => new Map(prev).set(runId, logs));
    } catch (e) {
      console.warn(`Failed to load logs for run ${runId}:`, e);
    }
  }, []);

  // Annotation handlers
  const handleSeenToggle = async (id: string, seen: boolean) => {
    const source = dataset.type === "production" ? "production" : "dataset_run";
    const item = items.find((i) => i.id === id);
    const wasSeen = item?.annotation?.seen ?? false;
    try {
      await upsertAnnotation(source as "production" | "dataset_run", id, { seen });
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, annotation: { ...it.annotation, seen, failureModes: it.annotation?.failureModes ?? [] } }
            : it,
        ),
      );
      // Burn-down progress = notes newly marked seen today (production only).
      if (dataset.type === "production" && seen !== wasSeen) {
        bumpReviewedToday(seen ? 1 : -1);
        // The header total counts items matching the current seen filter; a
        // toggle moves this item across that boundary, so track it live (the
        // next page-1 fetch replaces it with the server's number).
        const wantSeen = pageFilters?.seen;
        if (wantSeen !== undefined) {
          setTotalItems((t) => (t == null ? t : Math.max(0, t + (seen === wantSeen ? 1 : -1))));
        }
        // Keep the server-derived counts live without waiting for the
        // reconcile: the item's unseen count (burndown, pills) moves now.
        const ft = item?.failureType;
        if (ft) {
          setCountsData((prev) =>
            prev && {
              ...prev,
              byFailureType: prev.byFailureType.map((row) =>
                row.failureType === ft
                  ? {
                      ...row,
                      unseen: Math.max(0, row.unseen + (seen ? -1 : 1)),
                      current:
                        wantSeen === undefined
                          ? row.current
                          : Math.max(0, row.current + (seen === wantSeen ? 1 : -1)),
                    }
                  : row,
              ),
            },
          );
        }
        scheduleCountsReconcile();
      }
    } catch (err: any) {
      console.error("Failed to update seen:", err);
    }
  };

  const handleHighValueToggle = async (id: string, highValue: boolean) => {
    const source = dataset.type === "production" ? "production" : "dataset_run";
    // Optimistic: flip the star immediately so the click has instant feedback,
    // then persist. If the write fails, revert and tell the user.
    const setHV = (hv: boolean) =>
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, annotation: { ...item.annotation, highValue: hv, seen: item.annotation?.seen ?? false, failureModes: item.annotation?.failureModes ?? [] } }
            : item,
        ),
      );
    setHV(highValue);
    try {
      await upsertAnnotation(source as "production" | "dataset_run", id, { highValue });
    } catch (err: any) {
      console.error("Failed to update high_value:", err);
      setHV(!highValue); // revert
      alert(`Couldn't save high-value: ${err?.message ?? JSON.stringify(err)}`);
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
      // Keep the tag pill counts in step without waiting for the reconcile:
      // apply the same add/remove diff we just persisted to the server counts.
      if (dataset.type === "production") {
        setCountsData((prev) => {
          if (!prev) return prev;
          const added = modes.filter((m) => !prevModes.includes(m));
          const removed = prevModes.filter((m) => !modes.includes(m));
          if (!added.length && !removed.length) return prev;
          const rows = new Map(prev.tagCounts.map((t) => [t.tag, { ...t }]));
          for (const m of added) {
            const row = rows.get(m) ?? { tag: m, total: 0, current: 0, last30d: 0 };
            row.total++;
            row.current++;
            rows.set(m, row);
          }
          for (const m of removed) {
            const row = rows.get(m);
            if (!row) continue;
            row.total = Math.max(0, row.total - 1);
            row.current = Math.max(0, row.current - 1);
          }
          return { ...prev, tagCounts: [...rows.values()] };
        });
        scheduleCountsReconcile();
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

      {/* Burn-down pace bar — how much of the review backlog to clear today. */}
      {dataset.type === "production" && (
        <BurndownBar unseen={burndownUnseen} reviewedToday={reviewedToday} ready={countsData != null} inflowPerDay={burndownInflowPerDay} pacePerDay={reviewPacePerDay} />
      )}

      {/* Filters */}
      <div className="mb-4">
        <FilterBar
          source={dataset.type}
          filters={filters}
          counts={displayCounts}
          topicSetCounts={topicSetCounts}
          onFiltersChange={setFilters}
        />
      </div>

      {/* Collapsible drawers, grouped in one stack (Nathan 2026-07-28: "weird to
          have them separated"): A/B test filters, failure-mode tags, posting limit. */}
      <div className="mb-4 space-y-1">
      {/* A/B test filters. The toggle bar is ALWAYS shown in production (not gated on
          abSlots) so it doesn't pop in and shift the layout when the slots — derived
          from the progressively-loaded items — arrive a beat later. Collapsed by
          default; expanding before the data lands shows a "Loading…" placeholder.
          The bar is the section header; the panel's own header is hidden. */}
      {(dataset.type === "production" || abSlots.length > 0) && (
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAbOpen((o) => !o)}
              aria-expanded={abOpen}
              className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-gray-700 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100"
            >
              <span className={`text-gray-400 transition-transform ${abOpen ? "rotate-90" : ""}`}>▶</span>
              <span>A/B test filters</span>
              {abActive && <span className="text-xs text-blue-600">· {abActiveCount} active</span>}
            </button>
            {abActive && (
              <button
                onClick={() => setAbFilters({})}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Clear all
              </button>
            )}
          </div>
          {abOpen && (
            <div className="mt-2">
              {countsData != null && abSlots.length > 0 ? (
                <AbFilterPanel slots={abSlots} filters={abFilters} onChange={setAbFilters} hideHeader />
              ) : (
                <div className="text-sm text-gray-400 px-3 py-2">Loading…</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Failure-mode tags drawer — collapsible, same style as A/B test filters. */}
      {failureModeCatalog.length > 0 && (
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTagsOpen((o) => !o)}
              aria-expanded={tagsOpen}
              className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-gray-700 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100"
            >
              <span className={`text-gray-400 transition-transform ${tagsOpen ? "rotate-90" : ""}`}>▶</span>
              <span>Failure mode tags</span>
              {filters.failureModes.size > 0 && (
                <span className="text-xs text-purple-600">· {filters.failureModes.size} active</span>
              )}
            </button>
            {filters.failureModes.size > 0 && (
              <button
                onClick={() => setFilters({ ...filters, failureModes: new Set() })}
                className="text-xs text-purple-600 hover:text-purple-800"
              >
                Clear all
              </button>
            )}
          </div>
          {tagsOpen && (
            <div className="mt-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={showTags}
                  onChange={(e) => setShowTags(e.target.checked)}
                  className="rounded"
                />
                Show tag chips on note cards
              </label>
              <div className="flex flex-wrap gap-1 items-center">
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
            </div>
          )}
        </div>
      )}

      {/* Posting limit (writing cap) — collapsed by default, lazy-loads on open. */}
      <PostingLimitDrawer />
      </div>

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
              ? filters.highValueOnly
                ? `${totalItems ?? visible.length} high-value notes · all time ★`
                : tagFilterActive
                  ? `${totalItems ?? visible.length} notes · all time, tagged`
                  : `${totalItems ?? visible.length} notes`
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
              failureModeUsage={cardSelectorCounts}
              showFixed={showFixedTags}
              showTags={showTags}
              onSeenToggle={handleSeenToggle}
              onHighValueToggle={handleHighValueToggle}
              onFailureModesChange={handleFailureModesChange}
              onCreateFailureMode={handleCreateFailureMode}
              onCommentChange={handleCommentChange}
              onRequestLogs={requestLogs}
            />
          </div>
        ))}
      </div>

      {/* Next-page indicator: the scroll listener fetches as you near the bottom. */}
      {dataset.type === "production" && (loadingMore || nextCursor) && (
        <div className="py-4 text-center text-sm text-gray-400">
          {loadingMore ? "Loading more…" : ""}
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
