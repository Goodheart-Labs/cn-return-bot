import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { FeedProjectRow, NnnRow, NoteRow } from "@cn/core/types";
import { useLoadedMyVotes } from "@cn/features/notes/useVotes";
import { useLoadMoreSentinel } from "@cn/features/query/useLoadMoreSentinel";
import { Button } from "@cn/ui/Button";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { BackToProjects } from "../components/BackToProjects";
import { FeedNoteCard } from "../components/FeedNoteCard";
import { NoteFeed, useFrozenTallies } from "../components/NoteFeed";
import { NoteFiltersButton } from "../components/NoteFiltersButton";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { RouteLink } from "../components/RouteLink";
import {
  arrangeFeed,
  contentOrder,
  DEFAULT_NOTE_FILTERS,
  entriesByClaim,
  feedLength,
  filterNotes,
  improvementsByOriginal,
  itemsWithNotes,
  MINIMUM_KEYS,
  minimumValues,
  notesByItem,
  type FeedOrder,
  type NoteFilters,
  type NoteMinimums,
  type RankTally,
} from "../lib/feed";
import { useAllNotesFeed, useItemNoteViewers, useProjects } from "../lib/feedQueries";
import { noteUrl, type Route } from "../lib/routing";
import { useStoredChoice, useStoredValue } from "../lib/useStoredValue";

const NO_NOTES: NoteRow[] = [];
const NO_ENTRIES: NnnRow[] = [];

const ORDERS: { id: FeedOrder; label: string }[] = [
  { id: "recent", label: "Newest" },
  { id: "mixed", label: "Mixed" },
  { id: "helpful", label: "Most helpful" },
];

/** The order the reader picked last time, remembered on this device. */
const ORDER_KEY = "cn:allNotesOrder";

/** The filters the reader set last time, remembered on this device. */
const FILTERS_KEY = "cn:allNotesFilters";

/** Reads the remembered filters. A minimum that is missing, or is not a whole
 *  number of at least zero, gets its default. So does a checkbox that is
 *  missing or not true or false. */
function parseFilters(stored: string | null): NoteFilters {
  let parsed: Partial<Record<keyof NoteFilters, unknown>> = {};
  try {
    parsed = JSON.parse(stored ?? "{}") ?? {};
  } catch {
    // Unreadable text means nothing usable was stored.
  }
  const validMinimum = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
  const minimums = MINIMUM_KEYS.map((key) => [key, validMinimum(parsed[key]) ? parsed[key] : DEFAULT_NOTE_FILTERS[key]]);
  const unvotedOnly = typeof parsed.unvotedOnly === "boolean" ? parsed.unvotedOnly : DEFAULT_NOTE_FILTERS.unvotedOnly;
  return { ...(Object.fromEntries(minimums) as NoteMinimums), unvotedOnly };
}

/** The largest value each minimum takes among the given notes. */
function largestValues(notes: NoteRow[], viewsOf: (note: NoteRow) => number, rankTally: (note: NoteRow) => RankTally): NoteMinimums {
  const largest = { views: 0, votes: 0, helpful: 0, notHelpful: 0 };
  for (const note of notes) {
    const values = minimumValues(note, viewsOf, rankTally(note));
    for (const key of MINIMUM_KEYS) largest[key] = Math.max(largest[key], values[key]);
  }
  return largest;
}

/** The ids of the notes the reader had voted on when the feed was last
 *  arranged. The page uses it to hide those notes. A vote cast after that
 *  moment does not hide its card, so the reader can still change the vote and
 *  read the donation notice. A new snapshot is taken when `resetKey` changes.
 *  It is undefined until the reader's votes have loaded for the first time. */
function useVotedNoteIds(resetKey: string): ReadonlySet<string> | undefined {
  const votes = useLoadedMyVotes();
  const [snapshot, setSnapshot] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  // Taking the snapshot during render is React's pattern for state derived
  // from props: React re-renders straight away with the new snapshot.
  if (votes && snapshot?.key !== resetKey) setSnapshot({ key: resetKey, ids: new Set(votes.keys()) });
  return snapshot?.ids;
}

/** How many cards the page renders at first, and how many more it adds each
 *  time the reader scrolls near the end. Every YouTube card starts a video
 *  player, so rendering all notes of the site at once would make the page
 *  slow. */
const CARDS_PER_STEP = 30;

/** Returns how many cards to render and the element to put after the last
 *  one. When that element comes near the screen, the count grows by one step.
 *  The count starts over when `resetKey` changes. */
function useGrowingCount(resetKey: string): [number, (sentinel: HTMLElement | null) => void] {
  const [count, setCount] = useState(CARDS_PER_STEP);
  const [countedFor, setCountedFor] = useState(resetKey);
  // Resetting during render is React's pattern for state derived from props:
  // React re-renders straight away with the new count.
  if (countedFor !== resetKey) {
    setCountedFor(resetKey);
    setCount(CARDS_PER_STEP);
  }
  const growCount = useCallback(() => setCount((shown) => shown + CARDS_PER_STEP), []);
  return [count, useLoadMoreSentinel(growCount, count)];
}

/** The creator a note belongs to, at the top of its card. It links to the
 *  creator's own page of notes. Beside it stands how many readers saw the notes
 *  on the post. */
function CreatorByline({ project, views, navigate }: { project: FeedProjectRow; views: number; navigate: (route: Route) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <RouteLink
        to={{ view: "notes", project: project.slug, item: null, note: null }}
        navigate={navigate}
        className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary hover:text-fg"
      >
        <ProjectAvatar project={project} size={22} />
        {project.name}
      </RouteLink>
      <span className="text-sm text-fg-muted" title="Readers outside our team who were shown the notes on this post">
        {views === 1 ? "1 view" : `${views} views`}
      </span>
    </div>
  );
}

/** Every note of every project in one feed. The reader picks the order: the
 *  newest notes first, the mixed order every project page uses, or the most
 *  helpful first. Filters hide notes the reader voted on and notes below a
 *  minimum of views or votes. By default the page shows only notes the reader
 *  has not voted on, on posts that at least 5 readers saw. Each card names its
 *  creator. */
export function AllNotesPage({ navigate }: { navigate: (route: Route) => void }) {
  const projectsQuery = useProjects();
  const { items, noteSet, failed, retry } = useAllNotesFeed();
  const viewersQuery = useItemNoteViewers();
  const [order, setOrder] = useStoredChoice(ORDER_KEY, ORDERS.map((o) => o.id), "recent");
  const [filters, setFilters] = useStoredValue(FILTERS_KEY, parseFilters, JSON.stringify);
  const notes = noteSet?.notes;
  const byItem = useMemo(() => notesByItem(notes?.values() ?? []), [notes]);
  const improvements = useMemo(() => improvementsByOriginal(notes?.values() ?? []), [notes]);
  const entries = useMemo(() => entriesByClaim(noteSet?.nnn.values() ?? []), [noteSet]);
  const projectsById = useMemo(() => new Map((projectsQuery.data ?? []).map((p) => [p.id, p])), [projectsQuery.data]);
  const rankTally = useFrozenTallies(notes?.values() ?? []);
  const feedKey = `${order} ${JSON.stringify(filters)}`;
  const [shownCount, setSentinel] = useGrowingCount(feedKey);
  const votedNoteIds = useVotedNoteIds(feedKey);
  const viewsOf = (note: NoteRow) => viewersQuery.data?.get(note.claim.item_id) ?? 0;

  let feed: ReactNode;
  let filtersButton: ReactNode = null;
  if (failed || projectsQuery.isError || viewersQuery.isError) {
    feed = (
      <div className="space-y-3">
        <p className="text-sm text-fg-secondary">These notes could not be loaded. The connection to our server failed.</p>
        <Button
          onClick={() => {
            retry();
            void projectsQuery.refetch();
            void viewersQuery.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  } else if (!items || !noteSet || !projectsQuery.data || !viewersQuery.data || !votedNoteIds) {
    feed = <p className="text-sm text-fg-muted">Loading…</p>;
  } else {
    const ordered = contentOrder(itemsWithNotes(items.values(), byItem), byItem, noteSet.notes);
    const filtered = filterNotes(ordered, filters, viewsOf, rankTally, votedNoteIds);
    const sections = arrangeFeed(filtered, order, rankTally, new Date());
    filtersButton = (
      <NoteFiltersButton filters={filters} onChange={setFilters} largest={largestValues(ordered, viewsOf, rankTally)} matchingNotes={filtered.length} />
    );
    const renderCard = (note: NoteRow) => {
      const post = items.get(note.claim.item_id);
      const project = post?.project_id ? projectsById.get(post.project_id) : undefined;
      return (
        <FeedNoteCard
          key={note.id}
          note={note}
          byline={project && <CreatorByline project={project} views={viewsOf(note)} navigate={navigate} />}
          post={post}
          improvements={improvements.get(note.id) ?? NO_NOTES}
          nnnEntries={entries.get(note.claim_id) ?? NO_ENTRIES}
          shareUrl={project ? noteUrl(project.slug, note.id) : window.location.href}
        />
      );
    };
    feed = filtered.length === 0 ? (
      <p className="text-sm text-fg-secondary">No notes match these filters.</p>
    ) : (
      <>
        <NoteFeed sections={sections} limit={shownCount} renderCard={renderCard} />
        {shownCount < feedLength(sections) && <div ref={setSentinel} aria-hidden="true" />}
      </>
    );
  }

  return (
    <main className="min-w-0 px-4 py-8 md:px-8">
      <div className="mx-auto mb-6 max-w-[40rem] space-y-4">
        <BackToProjects navigate={navigate} />
        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-title text-2xl font-bold text-fg">All notes</h1>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl label="Order" options={ORDERS} value={order} onChange={setOrder} />
            {filtersButton}
          </div>
        </div>
      </div>
      {feed}
    </main>
  );
}
