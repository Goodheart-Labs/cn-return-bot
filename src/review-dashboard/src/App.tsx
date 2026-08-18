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

// The pills for these failure types show how many items are left to review under
// the current seen and A/B filters. Every other pill shows its all-time total
// instead.
const SEEN_AWARE_FAILURE_TYPES: FailureType[] = ["rated_helpful", "rated_unhelpful", "lost_to_competitor"];

// The burndown is the review backlog we are clearing to zero. It holds the unseen
// notes that are rated helpful, rated unhelpful, or underwater. Notes that are
// still fresh and simply need more ratings are left out on purpose, because they
// would make the pile impossible to finish. The target date is fixed, so meeting
// the daily quota really does mean done for today. Edit the date to aim at a
// different day.
const BURNDOWN_TYPES = new Set<FailureType>(["rated_helpful", "rated_unhelpful", "underwater"]);
const BURNDOWN_TARGET_ISO = "2026-10-18";
// Nathan rates in bursts rather than every day. The quota therefore assumes this
// many rating days in a week. Nathan asked for it on 2026-08-06: "assume I rate 4
// days a week, set the rate for that".
const RATING_DAYS_PER_WEEK = 4;

// The tag catalog is cached here between sessions. The tags drawer paints from
// the last session's snapshot straight away, while a fresh copy is fetched in the
// background.
const CATALOG_CACHE_KEY = "reviewDashboard.catalogCache.v1";

function daysUntil(iso: string): number {
  const ms = new Date(iso + "T23:59:59").getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

// The pace bar at the top of the page. It says how much of the backlog to clear
// today to stay on track for BURNDOWN_TARGET_ISO, and it turns green once you have
// done enough. The quota is worked out from the unseen count at the start of the
// day, which is stored per day in localStorage. That way the quota cannot shrink
// away under you while you rate, and "done today" stays a fixed bar you can hit.
function BurndownBar({ unseen, reviewedToday, ready, inflowPerDay, pacePerDay }: { unseen: number; reviewedToday: number; ready: boolean; inflowPerDay: number; pacePerDay: number }) {
  const todayKey = new Date().toLocaleDateString("en-CA"); // This gives the local date as YYYY-MM-DD.
  const [dayStart, setDayStart] = useState<number | null>(null);
  // Whether the "at this rate" explainer is open. Clicking the projection text
  // toggles it.
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
    // The day's baseline is captured once, as soon as the data is ready. It only
    // sets the day's quota. Progress is measured by the reviewedToday counter
    // below, not by the drop in the unseen count. Notes the bot writes during the
    // day therefore cannot mask the reviewer's progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, todayKey]);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(`reviewDashboard.burndown.dismissed.${todayKey}`, "true"); } catch { /* ignore */ }
  };

  if (!ready || dayStart == null || dismissed) return null;
  const daysLeft = daysUntil(BURNDOWN_TARGET_ISO);
  // The quota is what one rating day has to clear to hit the target. It assumes
  // RATING_DAYS_PER_WEEK rating days in a week. The work left over is the backlog
  // plus the inflow across all the remaining calendar days. That total is spread
  // over the remaining rating days only. It is recomputed every day from the live
  // numbers, so falling behind raises it and getting ahead lowers it.
  const ratingDaysLeft = Math.max(1, daysLeft * (RATING_DAYS_PER_WEEK / 7));
  const quota = Math.max(1, Math.ceil((dayStart + inflowPerDay * daysLeft) / ratingDaysLeft));
  const progress = reviewedToday; // The notes you marked seen today. New notes cannot dilute it.
  const done = progress >= quota;
  const remainingToday = Math.max(0, quota - progress);
  // The bar goes full and green the moment the day's quota is met. The count keeps
  // rising past that point while the bar stays full.
  const pct = done ? 100 : Math.min(100, Math.round((progress / quota) * 100));
  const targetLabel = new Date(BURNDOWN_TARGET_ISO + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // This is the reality check. It asks when the pile actually reaches zero at the
  // pace of the last 14 days, once the inflow is subtracted. If the pile is not
  // shrinking at all, the answer is "not at this pace".
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
            ? `✓ Done for today. ${progress} reviewed`
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


// Puts the annotation edits made during this session back onto a freshly fetched
// list. A reviewer can only edit notes that are on screen, and those are all in
// `prev`. This stops a fetch that lands in the middle of an edit from reverting
// it.
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

// Production items are filtered by the server, through compileFilters and the page
// function. Dataset-run items are all loaded into the browser instead, so they
// keep this local test. When tags are selected it matches on the tags alone.
// Otherwise it matches on the failure-type pills and the seen state.
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

// The production filter selection is saved across refreshes, so a reload does not
// snap back to the defaults. Nathan asked for this on 2026-07-15. A Set does not
// survive JSON, so the sets are written out as arrays and read back in. Only the
// production filters are saved. Dataset-run filters are short-lived and belong to
// one specific run.
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
    // The saved production selection is restored on load. A first ever visit falls
    // back to the defaults, which include Underwater. Note that
    // initialDatasetFromUrl is a function, so it has to be called. Reading `.type`
    // off the function itself would quietly give undefined.
    const initial = initialDatasetFromUrl();
    if (initial.type === "production") {
      const saved = loadSavedFilters();
      if (saved) return saved;
    }
    return defaultFilters(initial.type);
  });
  // The failure-mode tag chips on each note are hidden by default, because Nathan
  // finds them cluttering. The editor dropdown still shows them and still edits
  // them. This toggle is remembered across refreshes.
  const [showTags, setShowTags] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHOW_TAGS_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [abFilters, setAbFilters] = useState<ABFilters>({});
  // The A/B filter section starts collapsed.
  const [abOpen, setAbOpen] = useState(false);
  // The failure-mode tags drawer starts collapsed, so the large row of tag pills
  // does not clutter the top of the page. It uses the same collapsible style as
  // the A/B test filters section.
  const [tagsOpen, setTagsOpen] = useState(false);
  // The pill counts for a dataset run. Production pill counts come from the counts
  // function instead, in countsData below.
  const [counts, setCounts] = useState<Record<FailureType, number>>({} as any);
  // The production aggregates the server computes. They cover the pill counts over
  // all time, the unseen counts, the counts under the seen and A/B filters, the tag
  // counts, the burndown inputs, the A/B slot variants and the topic counts. An
  // annotation edit adjusts them here straight away, and a debounced refetch later
  // reconciles them with the server.
  const [countsData, setCountsData] = useState<DashboardCounts | null>(null);
  const [failureModeCatalog, setFailureModeCatalog] = useState<FailureModeInfo[]>([]);
  const [showFixedTags, setShowFixedTags] = useState(false);
  const [loading, setLoading] = useState(true);
  // The seen toggles made during this page session. They are added to the count
  // that comes from the database, and subtracted again once a fresh counts payload
  // arrives, because that payload already contains their annotations. A toggle is
  // therefore never counted twice. The ref mirrors the state, so a counts fetch can
  // read the value it started with without the effect re-running on every toggle.
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
  // The keyset cursor for the next production page. It is null when there are no
  // more pages. Below it sits the server's total number of matches for the current
  // filters.
  const [nextCursor, setNextCursor] = useState<PageCursor | null>(null);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Logs are fetched one card at a time, when a reviewer opens that card's log
  // panel. They are cached here, keyed by pipeline_run id.
  const [logsByRunId, setLogsByRunId] = useState<Map<string, Record<string, unknown>>>(new Map());
  useEffect(() => {
    fetchUploads().then((all) => {
      setUploads(all);
      // A dataset opened through ?upload=<id> starts out with the id as its name.
      // Now that the uploads have loaded, swap in the real name.
      setDataset((d) => {
        if (d.type !== "dataset_run" || !d.id) return d;
        const match = all.find((u) => u.id === d.id);
        return match ? { type: "dataset_run", id: match.id, name: match.name } : d;
      });
    }).catch((e) => console.warn("Failed to fetch uploads (table may not exist yet):", e));
    try {
      const raw = localStorage.getItem(CATALOG_CACHE_KEY);
      if (raw) setFailureModeCatalog(JSON.parse(raw));
    } catch { /* A corrupt cache is ignored. The fetch below overwrites it. */ }
    fetchFailureModes()
      .then((modes) => {
        setFailureModeCatalog(modes);
        try { localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(modes)); } catch { /* ignore */ }
      })
      .catch((e) => console.warn("Failed to fetch failure modes (table may not exist yet):", e));
  }, []);

  // The compiled server-side filters. They are also serialized to a string,
  // because the Sets inside FilterState get fresh identities on unrelated
  // re-renders, and the fetch effect needs a dependency that only changes when the
  // filters really change.
  const pageFilters = useMemo(
    () => (dataset.type === "production" ? compileFilters(filters, abFilters) : null),
    [dataset.type, filters, abFilters],
  );
  const filterKey = useMemo(() => JSON.stringify(pageFilters), [pageFilters]);
  // The counts function only reads the `seen` and `ab` keys. Keying its effect on
  // this narrower string means a pill click does not refetch the counts. Only a
  // change to the seen filter or to an A/B filter does.
  const countsKey = useMemo(
    () => JSON.stringify({ seen: pageFilters?.seen, ab: pageFilters?.ab }),
    [pageFilters],
  );

  // A counter that goes up on every load. A load started earlier can still finish
  // later, so every setState below checks this counter first and a stale response
  // is dropped.
  const loadSeq = useRef(0);

  // Loads the first page whenever the dataset or any server-side filter changes.
  // For production this fetches one page from the server, and scrolling appends
  // more pages through loadMore. A dataset run is still fetched in one go, and its
  // items carry their logs with them.
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
    // filterKey is the stable stand-in for pageFilters, which is read above.
  }, [dataset, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Appends the next page of production items.
  const loadMore = useCallback(async () => {
    // The check on `loading` matters. While the first page of a new filter set is
    // still in flight, the cursor still points into the old result set. Following
    // it would fetch a page of the wrong list.
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

  // Resets the filters when the reviewer switches to another dataset. The run on
  // mount is skipped, so a refresh keeps the selection restored from localStorage
  // instead of snapping back to the defaults.
  const didMountReset = useRef(false);
  useEffect(() => {
    if (!didMountReset.current) {
      didMountReset.current = true;
      return;
    }
    setFilters(defaultFilters(dataset.type));
    setAbFilters({});
  }, [dataset]);

  // Saves the production filter selection and the tag visibility across refreshes.
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

  // Loads whenever the dataset or the filters change. loadData is memoized on both
  // of them, so this fires once per real change.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fetches the production aggregates behind the pills, the tags, the burndown bar
  // and the A/B panel. They are only refetched when the seen or A/B filters change,
  // so a pill click reuses the last payload. The server takes about 250
  // milliseconds, which is fast enough that the client needs no cache of its own.
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
    // countsKey is the stable stand-in for the seen and ab parts of pageFilters.
  }, [dataset.type, countsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // An annotation edit adjusts countsData straight away, further down this file.
  // This refetch reconciles those adjustments with the server once a burst of
  // clicks has settled.
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

  // Production items arrive already sorted and filtered by the server. The only
  // narrowing left in the browser is the seen check below. It makes a card vanish
  // the moment you mark it seen while the "unseen" filter is on, with no refetch.
  // Dataset-run items are fully loaded, so they keep their own sort and filter
  // here.
  const filtered = useMemo(() => {
    if (dataset.type !== "production") {
      return [...items].sort(byCreatedDesc).filter(matchesDatasetFilters(filters));
    }
    const wantSeen = pageFilters?.seen;
    if (wantSeen === undefined) return items;
    return items.filter((i) => !!i.annotation?.seen === wantSeen);
  }, [dataset.type, items, filters, pageFilters]);

  // How many items sit in each topic set, for the topic-set filter chips. The
  // server counts the items per fine-grained topic. Grouping those topics into
  // sets lives in TypeScript, so the folding happens here.
  const topicSetCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of countsData?.topicCounts ?? []) {
      const set = topicSetFor(t.topic);
      if (set) c[set] = (c[set] ?? 0) + t.count;
    }
    return c;
  }, [countsData]);

  // The burndown backlog. It counts the unseen rated and underwater notes over all
  // time, as reported by the counts function. Marking a note seen decrements it
  // straight away.
  const burndownUnseen = useMemo(() => {
    let n = 0;
    for (const row of countsData?.byFailureType ?? []) {
      if (BURNDOWN_TYPES.has(row.failureType)) n += row.unseen;
    }
    return n;
  }, [countsData]);

  // How many notes join the burndown pile each day by becoming rated or underwater.
  // We do not store the date a note's status changed, so this uses a matured group
  // of notes instead. It takes the burndown notes submitted between 14 and 44 days
  // ago, which is old enough that most of their ratings have arrived, and spreads
  // them over that 30 day span. It undercounts a little while our posting volume is
  // still rising. It is measured from real data, and it corrects itself as each
  // group matures.
  const burndownInflowPerDay = useMemo(() => {
    let n = 0;
    for (const row of countsData?.byFailureType ?? []) {
      if (BURNDOWN_TYPES.has(row.failureType)) n += row.matured30d;
    }
    return n / 30;
  }, [countsData]);

  // Nathan's recent review pace. It counts the seen annotations touched in the last
  // 14 days. Any edit moves updated_at, so re-touching an old review counts here
  // again. That is accurate enough for a pace estimate.
  const reviewPacePerDay = useMemo(() => {
    const cutoff = Date.now() - 14 * 86400000;
    return (countsData?.seenAnnotationTimes ?? []).filter((t) => Date.parse(t) >= cutoff).length / 14;
  }, [countsData]);

  // How much was done today, taken from the database. It counts the seen
  // annotations whose updated_at falls on today's local date, and adds the toggles
  // made this session, which the fetched snapshot does not have yet. Because the
  // number comes from the database, it survives a refresh, another build and
  // another browser.
  const reviewedToday = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA"); // This gives the local date as YYYY-MM-DD.
    const n = (countsData?.seenAnnotationTimes ?? []).filter(
      (t) => new Date(t).toLocaleDateString("en-CA") === today,
    ).length;
    return Math.max(0, n + sessionSeenBumps);
  }, [countsData, sessionSeenBumps]);

  // True when any A/B slot is filtered. The `current` count from the server already
  // takes the seen and A/B filters into account. We only show it in place of the
  // all-time total when one of those two is actually narrowing the list.
  const abActive = useMemo(() => Object.values(abFilters).some(Boolean), [abFilters]);
  const abActiveCount = useMemo(() => Object.values(abFilters).filter(Boolean).length, [abFilters]);

  // The production pill counts. They are all-time totals, except for the rated
  // categories. Those report how many items are left under the current seen and
  // A/B filters.
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

  // The tag counts work the same way. They are all-time totals unless the seen or
  // A/B filters narrow the list.
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

  // The A/B slots, built from the server's counts for each slot and variant. They
  // are sorted in the order AB_TESTS declares them, so the dropdowns match the
  // layout of the stats dashboard. The date a variant was last picked drives the
  // "recently varied" flag, which the panel uses to hide dormant tests by default.
  const abSlots = useMemo(
    () =>
      buildAbTestSlots(
        (countsData?.abVariants ?? []).map((v) => ({ picks: { [v.slot]: v.variant }, at: v.lastPickedAt })),
        AB_TESTS,
      ),
    [countsData],
  );

  // Tag usage counted from the annotations on the loaded items. This is only
  // correct for dataset runs, because all of their items are loaded.
  const itemTagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const m of item.annotation?.failureModes ?? []) {
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  // The counts that label and sort the tag pills, and that order the tag selector
  // on each card. Production items are loaded one page at a time, so the server's
  // all-time counts are used there. Counting the loaded items would fall short.
  const tagCounts = dataset.type === "production" ? productionTagCounts : itemTagCounts;
  // The tag order uses all-time usage rather than the filtered counts, so the tag
  // list keeps a stable and meaningful order instead of reshuffling as you filter.
  // Nathan asked for this on 2026-07-21. The small count on each chip still
  // reflects the current view. Only the sort key is all-time.
  const tagOrderCounts = dataset.type === "production" ? productionTagOrderCounts : itemTagCounts;
  // The tag selector on each card sorts by usage in the last 30 days instead.
  // Nathan asked for this on 2026-07-28. Counts from the current view made the
  // order reshuffle with every filter. The last 30 days tracks what is going wrong
  // now, so failure modes that no longer happen sink to the bottom.
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

  // Folds the lazily loaded logs into the items the list is about to render. On the
  // first render an item carries no logs. Once requestLogs has filled logsByRunId,
  // the cards pick the logs up from here.
  const visible = useMemo(
    () =>
      filtered.map((item) => {
        const fromCache = item.pipelineRunId ? logsByRunId.get(item.pipelineRunId) : undefined;
        return fromCache ? { ...item, logs: fromCache } : item;
      }),
    [filtered, logsByRunId],
  );
  const tagFilterActive = dataset.type === "production" && filters.failureModes.size > 0;

  // Infinite scroll. The next page is fetched when the reviewer nears the bottom.
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
  // Scroll events only fire when the page actually moves. A reviewer parked at the
  // bottom never causes one, and neither does a list too short to scroll at all. So
  // the position is checked again after every append, every filter change and every
  // change in fetch state. Pages keep chaining until the content is long enough or
  // the cursor runs out.
  useEffect(() => {
    if (nearBottom()) loadMoreRef.current();
  }, [visible.length, nextCursor, loadingMore, loading]);

  // The list is newest first, so the top is often notes submitted so recently that
  // they have no ratings yet. This offers a jump to the first note that does have
  // ratings. The jump is only worth showing when unrated notes come before it.
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
    // Cards above the target load their tweet media as they scroll into view, so
    // each scroll makes the content above taller and pushes the target further
    // down. A single scrollIntoView therefore lands well short, and the more notes
    // sit above the target the worse it gets. So we scroll again and again, letting
    // the layout settle between tries, until the target holds at the top across a
    // few checks in a row. The try counter caps how long that can go on.
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

  // Fetches one run's logs when a card's log panel is expanded. The panel is
  // collapsed by default. Loading the logs for every visible card up front meant
  // pulling tens of megabytes at once, and a single slow or failed batch wiped the
  // logs for the whole page. Now that cost is only paid for the card the reviewer
  // actually opens. Dataset-run items carry their logs with them, so they never
  // call this. The result is cached in logsByRunId, so re-expanding is instant.
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
      // Burndown progress counts the notes newly marked seen today. Only
      // production items count towards it.
      if (dataset.type === "production" && seen !== wasSeen) {
        bumpReviewedToday(seen ? 1 : -1);
        // The total in the header counts the items matching the current seen
        // filter. This toggle moves the item across that boundary, so the total is
        // adjusted here. The next fetch of the first page replaces it with the
        // server's own number.
        const wantSeen = pageFilters?.seen;
        if (wantSeen !== undefined) {
          setTotalItems((t) => (t == null ? t : Math.max(0, t + (seen === wantSeen ? 1 : -1))));
        }
        // The counts from the server are adjusted now instead of waiting for the
        // reconcile, so the unseen count behind the burndown bar and the pills
        // moves at once.
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
    // The star is flipped immediately, so the click gives instant feedback, and
    // only then is it saved. If the write fails, the star flips back and the
    // reviewer is told.
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
      setHV(!highValue); // Put the star back the way it was.
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
      // The tag pill counts are kept in step without waiting for the reconcile.
      // The tags that were just added and removed are applied to the counts held
      // here as well.
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

      {/* The burndown pace bar. It says how much of the backlog to clear today. */}
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

      {/* The collapsible drawers sit in one stack: A/B test filters, failure-mode
          tags and the posting limit. Nathan asked for them to be grouped on
          2026-07-28, because it was "weird to have them separated". */}
      <div className="mb-4 space-y-1">
      {/* A/B test filters. In production the toggle bar always shows, rather than
          waiting for the slots, so it cannot pop in and shift the layout when the
          counts payload arrives a beat later. It starts collapsed. Expanding it
          before the counts land shows a "Loading…" placeholder. The bar acts as the
          section header, so the panel's own header is hidden. */}
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

      {/* The failure-mode tags drawer. It collapses in the same style as the A/B
          test filters. */}
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

      {/* The posting limit drawer. It starts collapsed and loads its data when it
          is opened. */}
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

      {/* The next-page indicator. The scroll listener fetches as you near the
          bottom. */}
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
