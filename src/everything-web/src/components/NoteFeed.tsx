import { Fragment, useState, type ReactNode } from "react";
import type { NoteRow } from "@cn/core/types";
import { firstNotes, tallyOf, type FeedSection, type RankTally } from "../lib/feed";

/** The divider above a labelled band of the feed. It names the band and says
 *  how many notes the whole band holds. */
function SectionDivider({ label, noteCount }: { label: string; noteCount: number }) {
  return (
    <div className="flex items-center gap-3 py-2 max-w-[40rem] mx-auto w-full" role="separator">
      <span className="flex-1 border-t-2 border-dotted border-line-strong" />
      <span className="text-xs text-fg-muted">{label} ({noteCount === 1 ? "1 note" : `${noteCount} notes`})</span>
      <span className="flex-1 border-t-2 border-dotted border-line-strong" />
    </div>
  );
}

/** The feed's cards, band by band. A band with a label sits below a divider
 *  that names it. A band renders only when it holds notes, so a feed with
 *  nothing rated yet shows no dividers at all. With a `limit`, only the
 *  first that many cards render, and each divider still counts its whole band. */
export function NoteFeed({ sections, renderCard, limit = Infinity }: {
  sections: FeedSection[];
  renderCard: (note: NoteRow) => ReactNode;
  limit?: number;
}) {
  const shown = firstNotes(sections, limit);
  return (
    <div className="space-y-4">
      {shown.map(({ label, notes }, index) => notes.length > 0 && (
        <Fragment key={label ?? ""}>
          {label && <SectionDivider label={label} noteCount={sections[index]!.notes.length} />}
          {notes.map(renderCard)}
        </Fragment>
      ))}
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
