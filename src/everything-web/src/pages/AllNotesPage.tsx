import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FeedProjectRow, NnnRow, NoteRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { BackToProjects } from "../components/BackToProjects";
import { FeedNoteCard } from "../components/FeedNoteCard";
import { NoteFeed, useFrozenTallies } from "../components/NoteFeed";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { RouteLink } from "../components/RouteLink";
import {
  arrangeFeed,
  contentOrder,
  entriesByClaim,
  feedLength,
  firstNotes,
  improvementsByOriginal,
  itemsWithNotes,
  notesByItem,
  type FeedOrder,
} from "../lib/feed";
import { useAllNotesFeed, useProjects } from "../lib/feedQueries";
import { noteUrl, type Route } from "../lib/routing";
import { useStoredChoice } from "../lib/useStoredChoice";

const NO_NOTES: NoteRow[] = [];
const NO_ENTRIES: NnnRow[] = [];

const ORDERS: { id: FeedOrder; label: string }[] = [
  { id: "mixed", label: "Mixed" },
  { id: "recent", label: "Newest" },
  { id: "helpful", label: "Most helpful" },
];

/** The order the reader picked last time, remembered on this device. */
const ORDER_KEY = "cn:allNotesOrder";

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
 *  creator's own page of notes. */
function CreatorByline({ project, navigate }: { project: FeedProjectRow; navigate: (route: Route) => void }) {
  return (
    <RouteLink
      to={{ view: "notes", project: project.slug, item: null, note: null }}
      navigate={navigate}
      className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary hover:text-fg"
    >
      <ProjectAvatar project={project} size={22} />
      {project.name}
    </RouteLink>
  );
}

/** Every note of every project in one feed. The reader picks the order: the
 *  mixed order every project page uses, the newest notes first, or the most
 *  helpful first. Each card names its creator. */
export function AllNotesPage({ navigate }: { navigate: (route: Route) => void }) {
  const projectsQuery = useProjects();
  const { items, noteSet, failed, retry } = useAllNotesFeed();
  const [order, setOrder] = useStoredChoice(ORDER_KEY, ORDERS.map((o) => o.id), "mixed");
  const notes = noteSet?.notes;
  const byItem = useMemo(() => notesByItem(notes?.values() ?? []), [notes]);
  const improvements = useMemo(() => improvementsByOriginal(notes?.values() ?? []), [notes]);
  const entries = useMemo(() => entriesByClaim(noteSet?.nnn.values() ?? []), [noteSet]);
  const projectsById = useMemo(() => new Map((projectsQuery.data ?? []).map((p) => [p.id, p])), [projectsQuery.data]);
  const rankTally = useFrozenTallies(notes?.values() ?? []);
  const [shownCount, setSentinel] = useGrowingCount(order);

  let feed: ReactNode;
  if (failed || projectsQuery.isError) {
    feed = (
      <div className="space-y-3">
        <p className="text-sm text-fg-secondary">These notes could not be loaded. The connection to our server failed.</p>
        <Button
          onClick={() => {
            retry();
            void projectsQuery.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  } else if (!items || !noteSet || !projectsQuery.data) {
    feed = <p className="text-sm text-fg-muted">Loading…</p>;
  } else {
    const sections = arrangeFeed(contentOrder(itemsWithNotes(items.values(), byItem), byItem, noteSet.notes), order, rankTally);
    const renderCard = (note: NoteRow) => {
      const post = items.get(note.claim.item_id);
      const project = post?.project_id ? projectsById.get(post.project_id) : undefined;
      return (
        <FeedNoteCard
          key={note.id}
          note={note}
          byline={project && <CreatorByline project={project} navigate={navigate} />}
          post={post}
          improvements={improvements.get(note.id) ?? NO_NOTES}
          nnnEntries={entries.get(note.claim_id) ?? NO_ENTRIES}
          shareUrl={project ? noteUrl(project.slug, note.id) : window.location.href}
        />
      );
    };
    feed = (
      <>
        <NoteFeed sections={firstNotes(sections, shownCount)} renderCard={renderCard} />
        {shownCount < feedLength(sections) && <div ref={setSentinel} aria-hidden="true" />}
      </>
    );
  }

  return (
    <main className="min-w-0 px-4 py-8 md:px-8">
      <div className="mx-auto mb-6 max-w-[40rem] space-y-4">
        <BackToProjects navigate={navigate} />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-title text-2xl font-bold text-fg">All notes</h1>
          <SegmentedControl label="Order" options={ORDERS} value={order} onChange={setOrder} />
        </div>
      </div>
      {feed}
    </main>
  );
}
