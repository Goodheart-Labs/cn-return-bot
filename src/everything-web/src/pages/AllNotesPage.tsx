import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FeedProjectRow, NnnRow, NoteRow } from "@cn/core/types";
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
  filterValues,
  improvementsByOriginal,
  itemsWithNotes,
  matchesAuthor,
  noteAuthors,
  notesByItem,
  type AuthorFilter,
  type FeedOrder,
  type NoteFilters,
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

/** The author the reader picked last time, remembered on this device. */
const AUTHOR_KEY = "cn:allNotesAuthor";

/** Reads the remembered author. Anything that is not one of the author
 *  choices reads as "anyone". */
function parseAuthor(stored: string | null): AuthorFilter {
  if (stored === "ai" || stored === "people" || stored?.startsWith("person:")) return stored as AuthorFilter;
  return "anyone";
}

/** Reads the remembered filters. A filter that is missing, or is not a whole
 *  number of at least zero, gets its default. */
function parseFilters(stored: string | null): NoteFilters {
  let parsed: Partial<Record<keyof NoteFilters, unknown>> = {};
  try {
    parsed = JSON.parse(stored ?? "{}") ?? {};
  } catch {
    // Unreadable text means nothing usable was stored.
  }
  const valid = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
  const entries = Object.entries(DEFAULT_NOTE_FILTERS).map(([key, fallback]) => {
    const value = parsed[key as keyof NoteFilters];
    return [key, valid(value) ? value : fallback];
  });
  return Object.fromEntries(entries) as NoteFilters;
}

/** The largest value each filter takes among the given notes. */
function largestValues(notes: NoteRow[], viewsOf: (note: NoteRow) => number, rankTally: (note: NoteRow) => RankTally): NoteFilters {
  const largest = { views: 0, votes: 0, helpful: 0, notHelpful: 0 };
  for (const note of notes) {
    const values = filterValues(note, viewsOf, rankTally(note));
    for (const key of Object.keys(largest) as (keyof NoteFilters)[]) largest[key] = Math.max(largest[key], values[key]);
  }
  return largest;
}

/** How many cards the page renders at first, and how many more it adds each
 *  time the reader scrolls near the end. Every YouTube card starts a video
 *  player, so rendering all notes of the site at once would make the page
 *  slow. */
const CARDS_PER_STEP = 30;

/** How far below the screen the end of the feed may still be when the next
 *  cards are added, so they are ready before the reader gets there. */
const LOAD_AHEAD_MARGIN = "1500px";

/** Returns how many cards to render and the element to put after the last
 *  one. When that element comes near the screen, the count grows by one step.
 *  The count starts over when `resetKey` changes. */
function useGrowingCount(resetKey: string): [number, (sentinel: HTMLDivElement | null) => void] {
  const [count, setCount] = useState(CARDS_PER_STEP);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const [countedFor, setCountedFor] = useState(resetKey);
  // Resetting during render is React's pattern for state derived from props:
  // React re-renders straight away with the new count.
  if (countedFor !== resetKey) {
    setCountedFor(resetKey);
    setCount(CARDS_PER_STEP);
  }
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setCount((shown) => shown + CARDS_PER_STEP);
      },
      { rootMargin: `0px 0px ${LOAD_AHEAD_MARGIN} 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, count]);
  return [count, setSentinel];
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
 *  helpful first. A filter can keep only the AI's notes, only people's notes,
 *  or one person's notes. Other filters hide notes below a minimum of views or
 *  votes. By default only notes on posts that at least 5 readers saw are
 *  shown. Each card names its creator. */
export function AllNotesPage({ navigate }: { navigate: (route: Route) => void }) {
  const projectsQuery = useProjects();
  const { items, noteSet, failed, retry } = useAllNotesFeed();
  const viewersQuery = useItemNoteViewers();
  const [order, setOrder] = useStoredChoice(ORDER_KEY, ORDERS.map((o) => o.id), "recent");
  const [filters, setFilters] = useStoredValue(FILTERS_KEY, parseFilters, JSON.stringify);
  const [author, setAuthor] = useStoredValue(AUTHOR_KEY, parseAuthor, String);
  const notes = noteSet?.notes;
  const byItem = useMemo(() => notesByItem(notes?.values() ?? []), [notes]);
  const improvements = useMemo(() => improvementsByOriginal(notes?.values() ?? []), [notes]);
  const entries = useMemo(() => entriesByClaim(noteSet?.nnn.values() ?? []), [noteSet]);
  const projectsById = useMemo(() => new Map((projectsQuery.data ?? []).map((p) => [p.id, p])), [projectsQuery.data]);
  const rankTally = useFrozenTallies(notes?.values() ?? []);
  const [shownCount, setSentinel] = useGrowingCount(`${order} ${author} ${JSON.stringify(filters)}`);
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
  } else if (!items || !noteSet || !projectsQuery.data || !viewersQuery.data) {
    feed = <p className="text-sm text-fg-muted">Loading…</p>;
  } else {
    const ordered = contentOrder(itemsWithNotes(items.values(), byItem), byItem, noteSet.notes);
    const filtered = filterNotes(ordered.filter((note) => matchesAuthor(note, author)), filters, viewsOf, rankTally);
    const sections = arrangeFeed(filtered, order, rankTally, new Date());
    filtersButton = (
      <NoteFiltersButton
        filters={filters}
        onChange={setFilters}
        author={author}
        onAuthorChange={setAuthor}
        authors={noteAuthors(ordered)}
        largest={largestValues(ordered, viewsOf, rankTally)}
        matchingNotes={filtered.length}
      />
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
