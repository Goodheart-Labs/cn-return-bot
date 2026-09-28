import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FeedProjectRow, NnnRow, NoteRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { FeedNoteCard } from "../components/FeedNoteCard";
import { ItemChips } from "../components/ItemChips";
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
import { noteUrl } from "../lib/routing";

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
        <span className="text-xs text-fg-subtle">{label}</span>
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

/** Scrolls to a shared note once its card has rendered. It scrolls again a few
 *  times over the next two seconds, because the YouTube iframes load late and
 *  shift the layout underneath it. */
function useScrollToNote(noteId: string | null, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready || !noteId || !document.getElementById(`note-${noteId}`)) return;
    done.current = true;
    for (const ms of [0, 400, 1000, 1800]) {
      setTimeout(() => document.getElementById(`note-${noteId}`)?.scrollIntoView({ block: "start" }), ms);
    }
  });
}

/** One project's notes, ranked, with a row of links that narrows the feed to
 *  one item: one post, video or page. */
export function FeedPage({ project, itemId, noteId, onSelectItem }: {
  project: FeedProjectRow;
  itemId: string | null;
  noteId: string | null;
  onSelectItem: (itemId: string | null) => void;
}) {
  const { items, noteSet, failed, retry } = useProjectFeed(project.id);
  const notes = noteSet?.notes;
  const byItem = useMemo(() => notesByItem(notes?.values() ?? []), [notes]);
  const improvements = useMemo(() => improvementsByOriginal(notes?.values() ?? []), [notes]);
  const entries = useMemo(() => entriesByClaim(noteSet?.nnn.values() ?? []), [noteSet]);
  const rankTally = useFrozenTallies(notes?.values() ?? []);
  const loaded = !!items && !!noteSet;
  useScrollToNote(noteId, loaded);

  if (failed) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-fg-secondary">These notes could not be loaded. The connection to our server failed.</p>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (!loaded) return <p className="text-sm text-fg-muted">Loading…</p>;

  const projectItems = itemsWithNotes(items.values(), byItem);
  // An item link that is stale or belongs to another project shows the whole
  // project, which beats an empty feed.
  const activeItem = projectItems.some((i) => i.id === itemId) ? itemId : null;
  const shown = projectItems.filter((i) => !activeItem || i.id === activeItem);
  const sections = rankFeed(contentOrder(shown, byItem, noteSet.notes), rankTally);
  const renderCard = (note: NoteRow) => (
    <FeedNoteCard
      key={note.id}
      note={note}
      improvements={improvements.get(note.id) ?? NO_NOTES}
      nnnEntries={entries.get(note.claim_id) ?? NO_ENTRIES}
      shareUrl={noteUrl(project.slug, note.id)}
    />
  );

  return (
    <>
      <ItemChips
        items={projectItems}
        noteCounts={new Map(projectItems.map((i) => [i.id, byItem.get(i.id)!.length]))}
        selected={activeItem}
        onSelect={onSelectItem}
      />
      {projectItems.length === 0 && <p className="text-sm text-fg-muted">No notes yet for this project.</p>}
      <div className="space-y-4">
        {sections.leading.map(renderCard)}
        <NoteSection label="Unhelpful notes" notes={sections.unhelpful} render={renderCard} />
        <NoteSection label="Source has since changed" notes={sections.staleSource} render={renderCard} />
      </div>
    </>
  );
}
