import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { track } from "@cn/core/analytics";
import { creatorPlatform } from "@cn/core/projects";
import type { FeedItemRow, FeedProjectRow, NnnRow, NoteRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { ResizablePanel } from "@cn/ui/ResizablePanel";
import { FeedNoteCard } from "../components/FeedNoteCard";
import { BackToProjects } from "../components/BackToProjects";
import { ItemList } from "../components/ItemList";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { RouteLink } from "../components/RouteLink";
import { WriteNoteModal } from "../components/WriteNoteModal";
import {
  contentOrder,
  entriesByClaim,
  improvementsByOriginal,
  itemsWithNotes,
  notesByItem,
  rankFeed,
  tallyOf,
  type RankTally,
} from "../lib/feed";
import { useProjectFeed } from "../lib/feedQueries";
import { noteUrl, type Route } from "../lib/routing";

const NO_NOTES: NoteRow[] = [];
const NO_ENTRIES: NnnRow[] = [];

/** A labelled band of the feed. It renders only when it holds notes, so a
 *  project with nothing rated yet shows no dividers at all. */
function NoteSection({ label, notes, render }: { label: string; notes: NoteRow[]; render: (note: NoteRow) => ReactNode }) {
  if (notes.length === 0) return null;
  return (
    <>
      <div className="flex items-center gap-3 py-2 max-w-[40rem] mx-auto w-full" role="separator">
        <span className="flex-1 border-t-2 border-dotted border-line-strong" />
        <span className="text-xs text-fg-muted">{label}</span>
        <span className="flex-1 border-t-2 border-dotted border-line-strong" />
      </div>
      {notes.map(render)}
    </>
  );
}

/** The vote counts each note is ranked by: the counts it had when it first
 *  appeared. So no card moves under the reader, least of all the one they just
 *  voted on, while the card itself keeps showing the live counts. Opening the
 *  project again re-sorts. */
function useFrozenTallies(notes: Iterable<NoteRow>): (note: NoteRow) => RankTally {
  const [frozen, setFrozen] = useState<ReadonlyMap<string, RankTally>>(new Map());
  const unseen = [...notes].filter((n) => !frozen.has(n.id));
  // Recording a newly arrived note during render is React's pattern for state
  // derived from props: React re-renders straight away with the new map.
  if (unseen.length > 0) setFrozen(new Map([...frozen, ...unseen.map((n) => [n.id, tallyOf(n)] as const)]));
  return (note) => frozen.get(note.id) ?? tallyOf(note);
}

/** When the scroll to a shared note runs, in milliseconds after its card
 *  first renders. */
const SCROLL_TO_NOTE_RETRIES_MS = [0, 400, 1000, 1800];

/** Scrolls to a shared note once its card has rendered. It scrolls again a few
 *  times over the next two seconds, because the YouTube iframes load late and
 *  shift the layout underneath it. */
function useScrollToNote(noteId: string | null, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready || !noteId || !document.getElementById(`note-${noteId}`)) return;
    done.current = true;
    for (const ms of SCROLL_TO_NOTE_RETRIES_MS) {
      setTimeout(() => document.getElementById(`note-${noteId}`)?.scrollIntoView({ block: "start" }), ms);
    }
  });
}

/** How wide the list of posts and videos starts, and how far it can be
 *  dragged. Titles are long, so readers can widen it. */
const ITEM_LIST_WIDTH = { default: 300, min: 220, max: 560 };

/** The top of the notes column. For the whole project it names the project,
 *  with the creator's picture and a link to their own page. For one item it
 *  names the item under the project's name, and the item's title links to the
 *  original. */
function PageHeading({ project, item, navigate }: { project: FeedProjectRow; item: FeedItemRow | null; navigate: (route: Route) => void }) {
  const platform = project.feed_url ? creatorPlatform(project.feed_url) : null;
  if (item) {
    return (
      <div className="min-w-0">
        <RouteLink
          to={{ view: "notes", project: project.slug, item: null, note: null }}
          navigate={navigate}
          className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary hover:text-fg"
        >
          <ProjectAvatar project={project} size={22} />
          {project.name}
        </RouteLink>
        {/* The title is the link to the original post or video. It reads as a
            plain title and turns blue under the pointer. */}
        <h1 className="mt-2 font-title text-2xl font-bold text-fg text-balance">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="rounded-control hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {item.title ?? "Untitled"}
          </a>
        </h1>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProjectAvatar project={project} size={48} />
      <div className="min-w-0">
        <h1 className="font-title text-2xl font-bold leading-tight text-fg text-balance">
          {/* Like an item's title, the project's name is the link to the
              creator's own page. It reads as a plain title and turns blue
              under the pointer. */}
          {project.feed_url ? (
            <a
              href={project.feed_url}
              target="_blank"
              rel="noopener noreferrer"
              title={platform ? `${project.name} on ${platform}` : undefined}
              className="rounded-control hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {project.name}
            </a>
          ) : (
            project.name
          )}
        </h1>
      </div>
    </div>
  );
}


/** One project: its posts and videos listed on the left, newest first, and
 *  beside them the ranked notes of the one picked, or of all of them. On a
 *  phone the list becomes a menu above the notes. */
export function ProjectPage({ project, itemId, noteId, navigate }: {
  project: FeedProjectRow;
  itemId: string | null;
  noteId: string | null;
  navigate: (route: Route) => void;
}) {
  const { items, noteSet, failed, retry } = useProjectFeed(project.id);
  const notes = noteSet?.notes;
  const byItem = useMemo(() => notesByItem(notes?.values() ?? []), [notes]);
  const improvements = useMemo(() => improvementsByOriginal(notes?.values() ?? []), [notes]);
  const entries = useMemo(() => entriesByClaim(noteSet?.nnn.values() ?? []), [noteSet]);
  const rankTally = useFrozenTallies(notes?.values() ?? []);
  const [writeOpen, setWriteOpen] = useState(false);
  const loaded = !!items && !!noteSet;
  useScrollToNote(noteId, loaded);

  const projectItems = loaded ? itemsWithNotes(items.values(), byItem) : [];
  // An item link that is stale or belongs to another project shows the whole
  // project, which beats an empty feed.
  const activeItem = projectItems.find((i) => i.id === itemId) ?? null;
  const noteCounts = new Map(projectItems.map((i) => [i.id, byItem.get(i.id)!.length]));
  const selectItem = (id: string | null) => navigate({ view: "notes", project: project.slug, item: id, note: null });

  let feed: ReactNode;
  if (failed) {
    feed = (
      <div className="space-y-3">
        <p className="text-sm text-fg-secondary">These notes could not be loaded. The connection to our server failed.</p>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  } else if (!loaded) {
    feed = <p className="text-sm text-fg-muted">Loading…</p>;
  } else if (projectItems.length === 0) {
    feed = <p className="text-sm text-fg-muted">No notes yet for this project.</p>;
  } else {
    const shown = activeItem ? [activeItem] : projectItems;
    const sections = rankFeed(contentOrder(shown, byItem, noteSet.notes), rankTally);
    const renderCard = (note: NoteRow) => (
      <FeedNoteCard
        key={note.id}
        note={note}
        post={activeItem ? undefined : items.get(note.claim.item_id)}
        improvements={improvements.get(note.id) ?? NO_NOTES}
        nnnEntries={entries.get(note.claim_id) ?? NO_ENTRIES}
        shareUrl={noteUrl(project.slug, note.id)}
      />
    );
    feed = (
      <div className="space-y-4">
        {sections.leading.map(renderCard)}
        <NoteSection label="Unhelpful notes" notes={sections.unhelpful} render={renderCard} />
        <NoteSection label="Source has since changed" notes={sections.staleSource} render={renderCard} />
      </div>
    );
  }

  return (
    <div className="md:flex">
      <ResizablePanel
        storageKey="cn:itemListWidth"
        label="list of posts and videos"
        defaultWidth={ITEM_LIST_WIDTH.default}
        minWidth={ITEM_LIST_WIDTH.min}
        maxWidth={ITEM_LIST_WIDTH.max}
        className="hidden bg-surface md:block md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]"
      >
        <div className="h-full space-y-5 overflow-y-auto px-3 py-5">
          <div className="px-3">
            <BackToProjects navigate={navigate} />
          </div>
          <ItemList projectSlug={project.slug} items={projectItems} noteCounts={noteCounts} selected={activeItem?.id ?? null} navigate={navigate} />
        </div>
      </ResizablePanel>

      <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
        <div className="mb-5 md:hidden">
          <BackToProjects navigate={navigate} />
        </div>
        <div className="mx-auto mb-6 flex max-w-[40rem] flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <PageHeading project={project} item={activeItem} navigate={navigate} />
          <Button
            variant="link"
            className="shrink-0 pt-1.5 text-sm font-medium"
            onClick={() => {
              setWriteOpen(true);
              // The modal is a "get the extension" teaser. Each open is a
              // reader asking for a write flow, which is extension demand.
              track("write_note_teaser_shown");
            }}
          >
            Write a note
          </Button>
        </div>
        <div className="mb-6 md:hidden">
          {projectItems.length > 1 && (
            <label className="block text-sm text-fg-secondary">
              <span className="sr-only">Post or video</span>
              <select
                value={activeItem?.id ?? ""}
                onChange={(e) => selectItem(e.target.value || null)}
                className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-fg"
              >
                <option value="">All posts and videos</option>
                {projectItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title ?? "Untitled"}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {feed}
      </main>

      <WriteNoteModal open={writeOpen} onClose={() => setWriteOpen(false)} navigate={navigate} />
    </div>
  );
}
