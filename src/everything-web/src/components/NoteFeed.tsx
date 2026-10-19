import { useState, type ReactNode } from "react";
import type { NoteRow } from "@cn/core/types";
import { tallyOf, type FeedSections, type RankTally } from "../lib/feed";

/** A labelled band of the feed. It renders only when it holds notes, so a
 *  feed with nothing rated yet shows no dividers at all. */
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

/** The feed's cards: the leading notes, then the unhelpful notes and the notes
 *  whose source changed, each below its own divider. */
export function NoteFeed({ sections, renderCard }: { sections: FeedSections; renderCard: (note: NoteRow) => ReactNode }) {
  return (
    <div className="space-y-4">
      {sections.leading.map(renderCard)}
      <NoteSection label="Unhelpful notes" notes={sections.unhelpful} render={renderCard} />
      <NoteSection label="Source has since changed" notes={sections.staleSource} render={renderCard} />
    </div>
  );
}

/** The vote counts each note is ranked by: the counts it had when it first
 *  appeared. So no card moves under the reader, least of all the one they just
 *  voted on, while the card itself keeps showing the live counts. Opening the
 *  page again re-sorts. */
export function useFrozenTallies(notes: Iterable<NoteRow>): (note: NoteRow) => RankTally {
  const [frozen, setFrozen] = useState<ReadonlyMap<string, RankTally>>(new Map());
  const unseen = [...notes].filter((n) => !frozen.has(n.id));
  // Recording a newly arrived note during render is React's pattern for state
  // derived from props: React re-renders straight away with the new map.
  if (unseen.length > 0) setFrozen(new Map([...frozen, ...unseen.map((n) => [n.id, tallyOf(n)] as const)]));
  return (note) => frozen.get(note.id) ?? tallyOf(note);
}
