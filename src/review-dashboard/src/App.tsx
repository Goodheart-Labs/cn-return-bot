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
  fetchDashboardData,
  fetchAllNotesCanonical,
  fetchAllNotesPhase1,
  assembleAllNotes,
  fetchDashboardDataByTags,
  fetchDashboardDataHighValue,
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

// The list loads every note, whatever its status and however old it is, so there is
// no "load more" button. Some items do not live in the `notes` table at all. Those
// are the notes rejected for a low evaluation score, the missed opportunities and
// the drafts. There are far too many of them over all time, so we only load the
// ones from the last few days, in the background.
const SECONDARY_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// How many note cards we mount at once. A filter can match thousands of notes, and
// mounting thousands of cards makes the browser stutter. So we mount this many and
// add another batch each time the user scrolls near the bottom. The note count shown
// above the list is still the true number of matches, not the number mounted.
const RENDER_PAGE = 100;

// For these failure types the pill shows how many notes are left to review under the
// current seen filter, rather than the all-time total. Every other pill keeps its
// all-time total. The remaining categories could not work this way anyway, because
// the pill query never loads a seen flag for them.
const SEEN_AWARE_FAILURE_TYPES: FailureType[] = ["rated_helpful", "rated_unhelpful", "lost_to_competitor"];

// The burn-down backlog is the set of notes you are clearing to zero. It holds the
// notes that have been rated helpful or unhelpful, plus the underwater ones. Notes
// that are still only waiting for more ratings are left out on purpose, because the
// whole set would be too much to get through. The target date is fixed, so hitting
// the daily quota really does mean you are done for today. Change the date to aim at
// a different deadline.
const BURNDOWN_TYPES = new Set<FailureType>(["rated_helpful", "rated_unhelpful", "underwater"]);
const BURNDOWN_TARGET_ISO = "2026-10-18";
// Nathan reviews in bursts rather than every day. So the quota assumes he reviews on
// this many days per week. He asked for this on 2026-08-06: "assume I rate 4 days a
// week, set the rate for that".
const RATING_DAYS_PER_WEEK = 4;

// These caches hold the results of the slow fetches that run once per session. The
// burndown bar, the pills and the tags drawer paint straight away from the snapshot
// the last session left behind. Fresh data replaces it quietly once the scans
// finish. Without this the boxes pop in one by one.
const PILL_CACHE_KEY = "reviewDashboard.pillCache.v1";
const CATALOG_CACHE_KEY = "reviewDashboard.catalogCache.v1";

function daysUntil(iso: string): number {
  const ms = new Date(iso + "T23:59:59").getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

// The bar at the top of the page says how much of the review backlog to clear today
// to stay on track for BURNDOWN_TARGET_ISO. It turns green once you have done
// enough. The quota is worked out from the number of unseen notes at the start of
// the day, which is stored per day in localStorage. That keeps the quota fixed while
// you work, so the target cannot shrink away from you as you review.
function BurndownBar({ unseen, reviewedToday, ready, inflowPerDay, pacePerDay }: { unseen: number; reviewedToday: number; ready: boolean; inflowPerDay: number; pacePerDay: number }) {
  const todayKey = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const [dayStart, setDayStart] = useState<number | null>(null);
  // Whether the "at this rate" explainer is open. Clicking the projection opens it.
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
    // We capture the day's baseline once, as soon as the data is ready. It is used
    // only to set the day's quota. Progress is measured by the reviewedToday counter
    // below, not by the drop in the unseen number. That way notes the bot writes
    // during the day cannot hide the reviewing you have done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, todayKey]);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(`reviewDashboard.burndown.dismissed.${todayKey}`, "true"); } catch { /* ignore */ }
  };

  if (!ready || dayStart == null || dismissed) return null;
  const daysLeft = daysUntil(BURNDOWN_TARGET_ISO);
  // The quota is how many notes one reviewing day has to clear to hit the target.
  // The work left over is today's backlog plus the notes that will arrive over all
  // the remaining calendar days. We spread that over the reviewing days that are
  // left, assuming RATING_DAYS_PER_WEEK of them each week. It is recomputed every
  // day from live numbers, so falling behind raises it and getting ahead lowers it.
  const ratingDaysLeft = Math.max(1, daysLeft * (RATING_DAYS_PER_WEEK / 7));
  const quota = Math.max(1, Math.ceil((dayStart + inflowPerDay * daysLeft) / ratingDaysLeft));
  const progress = reviewedToday; // Notes you marked seen today. New notes cannot lower it.
  const done = progress >= quota;
  const remainingToday = Math.max(0, quota - progress);
  // The bar goes full and green as soon as the quota is met. The reviewed count
  // keeps rising after that, but the bar stays full.
  const pct = done ? 100 : Math.min(100, Math.round((progress / quota) * 100));
  const targetLabel = new Date(BURNDOWN_TARGET_ISO + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // This is the reality check. It asks when the pile actually reaches zero at the
  // pace of the last 14 days, once the notes still arriving are subtracted. If the
  // pile is not shrinking at all we show "not at this pace" instead of a date.
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
  matchesAbFilters,
  type ABFilters,
} from "../../dashboard-shared/abFilters";
import { AB_TESTS } from "../../pipeline/ab-testing/abTestsData";


// Combine two lists of production items by id. When both lists hold the same id, the
// entry from `winners` is kept. The windowed fetch that supplies `winners` carries
// extra detail: competing notes, missed opportunities, low-eval rejections and the
// A/B picks for that window. Notes from outside the window only exist in `base`, so
// they survive the merge.
function mergeItemsById(base: ReviewItem[], winners: ReviewItem[]): ReviewItem[] {
  const byId = new Map(base.map((i) => [i.id, i]));
  for (const w of winners) byId.set(w.id, w);
  return [...byId.values()];
}

// Copy the annotation edits made during this session onto a freshly fetched list.
// You can only edit a note that is on screen, so every edit is already in `prev`.
// This stops a fetch that lands in the middle of an edit from reverting it.
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
    // Picking a topic set makes it the primary filter. Every note in that set is
    // shown, whatever its status or failure type, so choosing a topic simply lists
    // all of its notes for you to page through. The seen filter still narrows the
    // list further. It defaults to "unseen", the notes you have not reviewed yet.
    if (filters.topicSets.size > 0) {
      if (!item.topicSet || !filters.topicSets.has(item.topicSet)) return false;
      // A draft is a note the bot wrote but never posted. Drafts stay hidden even
      // under a topic filter, unless their own draft pill has been turned on. Most
      // of the time you do not want to see them.
      if (item.isDraft && !filters.failureTypes.has(item.failureType)) return false;
      if (filters.seen === "seen" && !(item.annotation?.seen)) return false;
      if (filters.seen === "unseen" && item.annotation?.seen) return false;
      return matchesAbFilters(item.abTestPicks ?? null, abFilters);
    }
    // The high-value filter shows only starred notes. The other filters still narrow
    // the list inside it. Turning the star on resets them to their widest setting in
    // FilterBar, so any narrowing here is something the user re-applied and can see.
    // An empty set of failure-type pills means "all types", so clearing the pills
    // cannot leave you looking at an empty list.
    if (filters.highValueOnly) {
      if (!item.annotation?.highValue) return false;
      if (filters.failureModes.size > 0) {
        const itemModes = item.annotation?.failureModes ?? [];
        if (!itemModes.some((m) => filters.failureModes.has(m))) return false;
      } else if (filters.failureTypes.size > 0 && !filters.failureTypes.has(item.failureType)) {
        return false;
      }
      if (filters.seen === "seen" && !(item.annotation?.seen)) return false;
      if (filters.seen === "unseen" && item.annotation?.seen) return false;
      return matchesAbFilters(item.abTestPicks ?? null, abFilters);
    }
    // Selecting failure-mode tags makes them the primary filter. Every item that
    // carries one of the selected tags is shown, whatever its failure type or seen
    // state. Tagged items are usually already marked seen, and many failure types
    // are off by default. Applying those filters here would hide the very items you
    // clicked to see.
    if (filters.failureModes.size > 0) {
      const itemModes = item.annotation?.failureModes ?? [];
      if (!itemModes.some((m) => filters.failureModes.has(m))) return false;
    } else {
      // The failure-type pills are an allow-list. An empty set means "all types",
      // the same as under the star filter. So clearing the pills and leaving only
      // "unseen" shows every unseen note rather than nothing at all. Drafts stay
      // opt-in. They are hidden unless their own draft pill is selected.
      const typeOk = filters.failureTypes.size === 0 || filters.failureTypes.has(item.failureType);
      if (!typeOk) return false;
      if (item.isDraft && !filters.failureTypes.has(item.failureType)) return false;
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

// We save the production filter selection so a reload does not snap back to the
// defaults. Nathan asked for this on 2026-07-15. A Set cannot be stored as JSON, so
// each one is converted to an array on the way out and back on the way in. Only the
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
    // We restore the saved production selection on load. On a first visit there is
    // nothing saved, so we fall back to the defaults, which include the underwater
    // notes. Note that initialDatasetFromUrl is a function and has to be called.
    // Reading `.type` off the function itself would always be undefined.
    const initial = initialDatasetFromUrl();
    if (initial.type === "production") {
      const saved = loadSavedFilters();
      if (saved) return saved;
    }
    return defaultFilters(initial.type);
  });
  // The failure-mode tag chips on each note are hidden by default, because Nathan
  // finds them cluttering. The dropdown on the card still shows and edits them. The
  // choice is saved across sessions.
  const [showTags, setShowTags] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHOW_TAGS_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [abFilters, setAbFilters] = useState<ABFilters>({});
  // The A/B filter section starts collapsed. Its dropdowns fill in as the data loads.
  const [abOpen, setAbOpen] = useState(false);
  // The failure-mode tags drawer starts collapsed, so the big row of pills does not
  // clutter the top of the page. It uses the same style as the A/B test filters.
  const [tagsOpen, setTagsOpen] = useState(false);
  const [counts, setCounts] = useState<Record<FailureType, number>>({} as any);
  // All-time tag usage for the production pills. We fetch it once per session and
  // adjust it in place when you edit a tag, rather than fetching it again. A dataset
  // run does not need this, because all of its items are loaded and can be counted.
  const [productionTagCounts, setProductionTagCounts] = useState<Map<string, number>>(new Map());
  const [productionTagCounts30d, setProductionTagCounts30d] = useState<Map<string, number>>(new Map());
  // The failure type and seen flag of every note, and the tags and seen flag of
  // every annotation, over all time. The rated pills and the tag pills use these to
  // show how many notes are left to review under the current seen filter, instead of
  // the all-time total. They arrive in the same fetch as the counts.
  const [notesSeen, setNotesSeen] = useState<{ noteId: string; failureType: FailureType; seen: boolean; abTestPicks: Record<string, string> | null }[]>([]);
  const [annotationsSeen, setAnnotationsSeen] = useState<{ targetId: string; failureModes: string[]; seen: boolean; abTestPicks: Record<string, string> | null }[]>([]);
  const [failureModeCatalog, setFailureModeCatalog] = useState<FailureModeInfo[]>([]);
  const [showFixedTags, setShowFixedTags] = useState(false);
  const [loading, setLoading] = useState(true);
  // How many notes you marked seen in this page session. It is added to the count
  // derived from the database below. The old counter lived in localStorage and
  // missed any reviewing done in another session or another build. It also used the
  // UTC date, so an evening click in California counted towards the next day.
  // Reading each annotation's updated_at instead makes "done today" survive all of
  // that.
  const [sessionSeenBumps, setSessionSeenBumps] = useState(0);
  const bumpReviewedToday = useCallback((delta: number) => {
    setSessionSeenBumps((n) => n + delta);
  }, []);
  // The A/B filter panel waits for the full notes fetch to finish. Its "recently
  // varied" detection needs to see every A/B pick in the window. The smaller set of
  // rows that paints first would not be enough.
  const [recentNotesLoaded, setRecentNotesLoaded] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In production we load every item up front, but only its metadata. The pipeline
  // logs are large, so we fetch them one run at a time when a card's log panel is
  // opened. They are cached here under the pipeline run id.
  const [logsByRunId, setLogsByRunId] = useState<Map<string, Record<string, unknown>>>(new Map());
  // Load the uploads and the failure-mode catalog when the page mounts.
  useEffect(() => {
    fetchUploads().then((all) => {
      setUploads(all);
      // When the page is opened with ?upload=<id> the dataset only has the id as
      // its name. Now that the uploads are here, use the real name.
      setDataset((d) => {
        if (d.type !== "dataset_run" || !d.id) return d;
        const match = all.find((u) => u.id === d.id);
        return match ? { type: "dataset_run", id: match.id, name: match.name } : d;
      });
    }).catch((e) => console.warn("Failed to fetch uploads (table may not exist yet):", e));
    try {
      const raw = localStorage.getItem(CATALOG_CACHE_KEY);
      if (raw) setFailureModeCatalog(JSON.parse(raw));
    } catch { /* A corrupt cache is harmless. The fetch below overwrites it. */ }
    fetchFailureModes()
      .then((modes) => {
        setFailureModeCatalog(modes);
        try { localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(modes)); } catch { /* ignore */ }
      })
      .catch((e) => console.warn("Failed to fetch failure modes (table may not exist yet):", e));
  }, []);

  // Selecting failure-mode tags changes what production loads. It fetches every
  // tagged item from all time instead of the usual set, so the tag selection is an
  // input to the fetch. We turn it into a string because the Set gets a new identity
  // on unrelated re-renders, which would re-fire loadData for no reason. For a
  // dataset run this stays empty, because its tag filtering happens in the browser.
  const productionTagKey = useMemo(
    () =>
      dataset.type === "production"
        ? JSON.stringify([...filters.failureModes].sort())
        : "",
    [dataset.type, filters.failureModes],
  );

  // Each load gets a number that only ever goes up. An older load that finishes
  // after a newer one must not overwrite the newer view, so every setState below
  // first checks that this is still the latest load.
  const loadSeq = useRef(0);

  // This loads the data whenever the dataset or the tag filter changes. Production
  // loads in two parts. Every note is loaded in full, with no date limit, so the main
  // list is always complete. The items that do not live in the notes table are
  // limited to a recent window. Selecting tags replaces both of those with a single
  // all-time fetch of everything carrying those tags. The pill counts are all-time
  // and come from a separate effect. A dataset run keeps its single fetch, which
  // already includes the logs.
  const loadData = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setRecentNotesLoaded(false);
    setError(null);
    try {
      if (dataset.type === "production") {
        // The high-value filter is its own all-time view. It fetches every starred
        // note whatever its age or status, the same way the tag filter does. It
        // takes precedence over the other production paths.
        if (filters.highValueOnly) {
          const data = await fetchDashboardDataHighValue();
          if (seq !== loadSeq.current) return;
          setItems(buildDashboardItems(data));
          setLogsByRunId(new Map());
          return;
        }
        const tags = [...filters.failureModes];
        if (tags.length > 0) {
          const data = await fetchDashboardDataByTags(tags);
          if (seq !== loadSeq.current) return;
          setItems(buildDashboardItems(data));
          setLogsByRunId(new Map());
          setRecentNotesLoaded(true);
          return;
        }
        // Phase one is the fast first paint. We load the note rows and their seen
        // state, which takes about two seconds, and render straight away. The note
        // text, the status and the unseen filter all work from that alone. We throw
        // away the rated-only set the server injects as __DEFAULT_VIEW__. Loading
        // every note is nearly as fast and avoids a flash of rated-only notes.
        (window as any).__DEFAULT_VIEW__ = null;
        const canonical = await fetchAllNotesCanonical();
        if (seq !== loadSeq.current) return;
        const phase1 = await fetchAllNotesPhase1(canonical);
        if (seq !== loadSeq.current) return;
        setItems((prev) => preserveAnnotations(prev, buildDashboardItems(phase1)));

        // Phase two enriches those notes in the background. It attaches the tweets,
        // the misinfo topic and the competing notes and ratings that decide a note's
        // category. That is combined with the recent items that do not live in the
        // notes table, which are the low-eval rejections, the missed opportunities
        // and the drafts. Both halves fail softly, so a slow or failed enrichment
        // cannot blank the list that is already on screen. `loading` stays true
        // through this, which is what shows the "loading all notes…" hint while the
        // extra data fills in. The finally block below clears it.
        const secondarySince = new Date(Date.now() - SECONDARY_WINDOW_DAYS * MS_PER_DAY).toISOString();
        const [allNotes, secondary] = await Promise.all([
          assembleAllNotes(canonical),
          fetchDashboardData(secondarySince).catch((e) => {
            console.warn("[dashboard] secondary items (low-eval / drafts) failed — showing notes only:", e);
            return null;
          }),
        ]);
        if (seq !== loadSeq.current) return;
        const noteItems = buildDashboardItems(allNotes);
        const merged = secondary ? mergeItemsById(noteItems, buildDashboardItems(secondary)) : noteItems;
        setItems((prev) => preserveAnnotations(prev, merged));
        setLogsByRunId(new Map());
        setRecentNotesLoaded(true);
      } else {
        const loaded = await fetchDatasetRunItems(dataset.id!);
        if (seq !== loadSeq.current) return;
        setItems(loaded);
        setCounts(await fetchDatasetRunCounts(dataset.id!));
        setRecentNotesLoaded(true);
      }
    } catch (err: any) {
      console.error("Failed to load data:", err);
      if (seq === loadSeq.current) setError(err?.message ?? "Failed to load data");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
    // productionTagKey stands in for filters.failureModes, which is read above.
  }, [dataset, productionTagKey, filters.highValueOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the filters when the dataset changes. The first run on mount is skipped,
  // so a refresh keeps the selection restored from localStorage instead of snapping
  // back to the defaults.
  const didMountReset = useRef(false);
  useEffect(() => {
    if (!didMountReset.current) {
      didMountReset.current = true;
      return;
    }
    setFilters(defaultFilters(dataset.type));
    setAbFilters({});
  }, [dataset]);

  // Save the production filter selection and the tag visibility across refreshes.
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

  // Reload whenever loadData changes. It is memoized on the dataset, the tag
  // selection and the high-value filter, so this fires once per real change.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // The pill data covers all time and does not depend on what the list has loaded,
  // so we fetch it once per production session. A single pass returns the all-time
  // counts together with the seen flag for every note and every annotation, which is
  // what the seen-aware pills are computed from.
  useEffect(() => {
    if (dataset.type !== "production") return;
    // The pill scan is the slowest fetch on the page. It scans whole tables and
    // takes around five seconds, and both the burndown bar and the pill counts wait
    // on it. So we render last session's snapshot at once and swap in the fresh data
    // quietly when it arrives. Nathan reported the boxes popping in one by one on
    // 2026-07-29.
    try {
      const raw = localStorage.getItem(PILL_CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        setCounts(c.counts);
        setProductionTagCounts(new Map(c.tagCounts));
        setProductionTagCounts30d(new Map(c.tagCounts30d ?? []));
        setNotesSeen(c.notesSeen ?? []);
        setAnnotationsSeen(c.annotationsSeen ?? []);
      }
    } catch { /* A corrupt cache is harmless. The fetch below overwrites it. */ }
    fetchProductionPillData()
      .then(({ counts, tagCounts, tagCounts30d, notesSeen, annotationsSeen }) => {
        setCounts(counts);
        setProductionTagCounts(tagCounts);
        setProductionTagCounts30d(tagCounts30d);
        setNotesSeen(notesSeen);
        setAnnotationsSeen(annotationsSeen);
        try {
          localStorage.setItem(PILL_CACHE_KEY, JSON.stringify({
            counts,
            tagCounts: [...tagCounts],
            tagCounts30d: [...tagCounts30d],
            notesSeen,
            annotationsSeen,
          }));
        } catch { /* Storage may be full. The cache is only an optimization. */ }
      })
      .catch((e) => console.warn("Failed to fetch production pill data:", e));
  }, [dataset]);

  // Sort the items by date. The memo stops renders from re-sorting for no reason.
  const sortedItems = useMemo(() => [...items].sort(byCreatedDesc), [items]);
  const filtered = sortedItems.filter(matchesFilters(filters, abFilters));
  // How many loaded items sit in each topic set, for the topic-set filter chips.
  const topicSetCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) if (it.topicSet) c[it.topicSet] = (c[it.topicSet] ?? 0) + 1;
    return c;
  }, [items]);

  // The loaded items, keyed by id. Their annotation state is the live truth and wins
  // over the all-time pill data below. You can only edit a note that is on screen, so
  // every seen flag and tag you change in this session is in here. That keeps the
  // counts current without another fetch. Mark a note seen and the "left to review"
  // count drops straight away.
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // The burn-down backlog counts the unseen notes that are rated or underwater. It
  // comes from the all-time pill scan, so it is the true total and not just what the
  // list has loaded. For a note that is loaded we use its live seen state instead,
  // so marking one seen ticks the counter down at once.
  const burndownUnseen = useMemo(() => {
    let n = 0;
    for (const ns of notesSeen) {
      if (!BURNDOWN_TYPES.has(ns.failureType)) continue;
      const live = itemById.get(ns.noteId);
      const seen = live ? !!live.annotation?.seen : ns.seen;
      if (!seen) n++;
    }
    return n;
  }, [notesSeen, itemById]);

  // How many notes join the burn-down pile each day by becoming rated or underwater.
  // We do not store when a note's status changed, so we use a stand-in. We count the
  // burn-down notes submitted between 14 and 44 days ago and divide by that 30-day
  // span. Notes that old have received most of the ratings they are going to get.
  // This undercounts a little while posting volume is still rising, but it is based
  // on real data and corrects itself as newer notes mature.
  const burndownInflowPerDay = useMemo(() => {
    const now = Date.now();
    const DAY = 86400000;
    let n = 0;
    for (const ns of notesSeen) {
      if (!BURNDOWN_TYPES.has(ns.failureType) || !ns.submittedAt) continue;
      const age = now - Date.parse(ns.submittedAt);
      if (age >= 14 * DAY && age < 44 * DAY) n++;
    }
    return n / 30;
  }, [notesSeen]);

  // Nathan's recent reviewing pace. We count the annotations marked seen whose
  // updated_at falls in the last 14 days. Any edit moves updated_at, so re-touching
  // an old review is counted here too. That over-counts a little, which is fine for
  // a pace estimate.
  const reviewPacePerDay = useMemo(() => {
    const cutoff = Date.now() - 14 * 86400000;
    let n = 0;
    for (const a of annotationsSeen) {
      if (a.seen && a.updatedAt && Date.parse(a.updatedAt) >= cutoff) n++;
    }
    return n / 14;
  }, [annotationsSeen]);

  // How much has been reviewed today, taken from the database. We count the
  // annotations marked seen whose updated_at falls on today's local date, and add
  // the ones toggled in this session, which the fetched snapshot does not have yet.
  // Because it comes from the database it survives refreshes, other builds and
  // other browsers.
  const reviewedToday = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
    let n = 0;
    for (const a of annotationsSeen) {
      if (a.seen && a.updatedAt && new Date(a.updatedAt).toLocaleDateString("en-CA") === today) n++;
    }
    return Math.max(0, n + sessionSeenBumps);
  }, [annotationsSeen, sessionSeenBumps]);

  // True when at least one A/B slot is filtered. An empty A/B filter matches
  // everything, so in that case the seen-aware counts are already correct. We only
  // recompute when the seen filter or an A/B filter is actually narrowing the list.
  const abActive = useMemo(() => Object.values(abFilters).some(Boolean), [abFilters]);
  const abActiveCount = useMemo(() => Object.values(abFilters).filter(Boolean).length, [abFilters]);

  // The production pill counts, made aware of the seen and A/B filters. For the
  // rated categories the pills report how many notes are left under those filters
  // rather than the all-time total. The numbers come from the all-time notesSeen
  // list, so nothing is undercounted, and a loaded note uses its live state instead.
  // When no filter is active we return the all-time counts unchanged.
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

  // The same idea again, for the failure-mode tag pills. We merge by id so a loaded
  // note uses its live annotation, including tags added or removed in this session.
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

  // The A/B slots are derived from the picks we actually see on the loaded items.
  // They are sorted in the order AB_TESTS declares them, so the dropdowns match the
  // stats dashboard. The createdAt values decide which tests count as recently
  // varied, and the panel hides the dormant ones by default.
  const abSlots = useMemo(
    () =>
      buildAbTestSlots(
        items.map((i) => ({ picks: i.abTestPicks, at: i.createdAt })),
        AB_TESTS,
      ),
    [items],
  );

  // Tag usage counted from the annotations on the loaded items. This is correct for
  // a dataset run, because all of its items are loaded.
  const itemTagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const m of item.annotation?.failureModes ?? []) {
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  // The counts that sort and label the pills, and that order the selector on each
  // card. In production the loaded list is not always the whole picture, so we use
  // the all-time counts that are aware of the seen filter. Counting the loaded items
  // instead would undercount.
  const tagCounts = dataset.type === "production" ? displayTagCounts : itemTagCounts;
  // The order of the tags uses all-time usage rather than the counts adjusted for
  // the current filters. That keeps the list in a stable, meaningful order instead
  // of reshuffling as you filter. Nathan asked for this on 2026-07-21. The small
  // number on each chip still shows the count for the current view. Only the sort
  // key is all-time.
  const tagOrderCounts = dataset.type === "production" ? productionTagCounts : itemTagCounts;
  // The dropdown on each card sorts by usage over the last 30 days instead. Nathan
  // asked for this on 2026-07-28, because the current-view counts reshuffled the
  // order with every filter change. The 30-day count tracks what is going wrong
  // now, so failure modes we no longer hit sink to the bottom.
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

  // Attach the lazily fetched logs to the items the list is about to render. On the
  // first render a card has no logs at all. Once a fetch has filled logsByRunId the
  // card picks its logs up from here.
  const visible = useMemo(
    () =>
      filtered.map((item) => {
        const fromCache = item.pipelineRunId ? logsByRunId.get(item.pipelineRunId) : undefined;
        return fromCache ? { ...item, logs: fromCache } : item;
      }),
    [filtered, logsByRunId],
  );
  const tagFilterActive = dataset.type === "production" && filters.failureModes.size > 0;

  // We mount only the first `renderLimit` cards and add more as you scroll towards
  // the bottom. The limit resets whenever the filtered set could have changed. The
  // count shown above the list is the true number of matches, not this limit.
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE);
  useEffect(() => { setRenderLimit(RENDER_PAGE); }, [filters, abFilters, dataset]);
  const rendered = useMemo(() => visible.slice(0, renderLimit), [visible, renderLimit]);
  useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1200) {
        setRenderLimit((n) => (n < visible.length ? n + RENDER_PAGE : n));
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [visible.length]);

  // The list is newest first, so the top is often notes that were just submitted and
  // have no ratings yet. We offer a jump to the first note that does have ratings.
  // The button only makes sense when unrated notes come before it.
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
    // The cards above the target load their tweet media as they scroll into view.
    // Each scroll therefore grows the content above the target and pushes it further
    // down. A single scrollIntoView lands well short, and the more notes come before
    // the target the worse it gets. So we scroll again and again, letting the layout
    // settle between tries, until the target stays at the top for a few checks in a
    // row. We give up after a fixed number of tries.
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

  // Fetch one run's logs when a card's log panel is opened. The panel starts
  // collapsed, so loading the logs for every visible card meant pulling tens of
  // megabytes of large JSON up front, and one slow or failed batch left the whole
  // page without logs. Now we only pay that cost for the card the user opens. A
  // dataset run carries its logs inline and never calls this. The result is cached
  // in logsByRunId, so re-opening a panel is instant.
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
    const targetId = dataset.type === "production" ? id : id;
    const wasSeen = items.find((i) => i.id === id)?.annotation?.seen ?? false;
    try {
      await upsertAnnotation(source as "production" | "dataset_run", targetId, { seen });
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, annotation: { ...item.annotation, seen, failureModes: item.annotation?.failureModes ?? [] } }
            : item,
        ),
      );
      // Burn-down progress counts the notes newly marked seen today. Only
      // production notes count towards it.
      if (dataset.type === "production" && seen !== wasSeen) bumpReviewedToday(seen ? 1 : -1);
    } catch (err: any) {
      console.error("Failed to update seen:", err);
    }
  };

  const handleHighValueToggle = async (id: string, highValue: boolean) => {
    const source = dataset.type === "production" ? "production" : "dataset_run";
    // We flip the star straight away so the click feels instant, then save it. If
    // the write fails we put the star back and tell the user.
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
      setHV(!highValue); // Put the star back.
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
      // Keep the all-time pill counts in step without fetching them again. We apply
      // the same additions and removals we just saved.
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

      {/* The burn-down pace bar. It shows how much of the review backlog to clear
          today. */}
      {dataset.type === "production" && (
        <BurndownBar unseen={burndownUnseen} reviewedToday={reviewedToday} ready={notesSeen.length > 0} inflowPerDay={burndownInflowPerDay} pacePerDay={reviewPacePerDay} />
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

      {/* The three collapsible drawers sit in one stack: A/B test filters,
          failure-mode tags and the posting limit. Nathan said on 2026-07-28 that it
          was "weird to have them separated". */}
      <div className="mb-4 space-y-1">
      {/* A/B test filters. In production the toggle bar is always shown, even before
          any slots exist. The slots are derived from the items as they load, so
          waiting for them would make the bar pop in and shift the layout. The
          section starts collapsed. Opening it before the data arrives shows a
          "Loading…" placeholder. The bar acts as the section header, so the panel's
          own header is hidden. */}
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
              {recentNotesLoaded && abSlots.length > 0 ? (
                <AbFilterPanel slots={abSlots} filters={abFilters} onChange={setAbFilters} hideHeader />
              ) : (
                <div className="text-sm text-gray-400 px-3 py-2">Loading…</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* The failure-mode tags drawer. It is collapsible, in the same style as the
          A/B test filters. */}
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

      {/* The posting limit is the daily cap on how many notes we may write. The
          drawer starts collapsed and loads its data when it is opened. */}
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
                ? `${visible.length} high-value notes · all time ★`
                : tagFilterActive
                  ? `${visible.length} notes · all time, tagged`
                  : `${visible.length} notes`
              : `${filtered.length} items shown`}
        </div>
        {loading && items.length > 0 && (
          <span className="text-xs text-gray-400">· loading all notes…</span>
        )}
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
        {rendered.map((item) => (
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

      {/* Upload dialog */}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
