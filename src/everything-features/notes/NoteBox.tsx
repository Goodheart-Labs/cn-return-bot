import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNoteSourceDetails } from "@cn/core/notes";
import type { NoteStatus } from "@cn/core/noteScore";
import type { NoteRow } from "@cn/core/types";
import { Quote } from "@cn/ui/typography";
import { LinkifiedText } from "../../dashboard-shared/LinkifiedText";
import { quoteFragmentUrl } from "../../dashboard-shared/textFragment";
import { queryKeys } from "../query/queryKeys";

/** The rating states, in the style of Community Notes: the colour of the
 *  status dot and the copy beside it. The note itself has no box and no tint,
 *  as on X, so the status line alone says which state a note is in. */
const STATUS: Record<NoteStatus, { label: string; dot: string }> = {
  helpful: { label: "Currently rated helpful", dot: "text-positive-solid" },
  not_helpful: { label: "Currently rated not helpful", dot: "text-negative-solid" },
  needs_ratings: { label: "Needs more ratings", dot: "text-pending-solid" },
};

/** The status line's words for a status, for labels that name it elsewhere. */
export const statusLabel = (status: NoteStatus): string => STATUS[status].label;

/** The status colour as a text colour class. The extension's page markers
 *  draw with it too, through `bg-current`, so a marker and the note it opens
 *  always agree. */
export const statusColorClass = (status: NoteStatus): string => STATUS[status].dot;

/** The one question every rating panel asks, whatever its status: notes, and
 *  the reader's key points and forecasts. */
export const ratingQuestion = (thing: "note" | "key point" | "forecast") => `Is this ${thing} helpful?`;

/** The status badge shown above a note. It is a filled circle followed by the
 *  Community Notes copy for that status. A status that has been decided also
 *  draws a ✓ or a ✕ inside the circle. */
export function StatusBadge({ status }: { status: NoteStatus }) {
  const { label, dot } = STATUS[status];
  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold text-fg-secondary">
      {/* The size is given in em so the icon scales with the site's larger
          type scale. The circle fills the whole viewBox, and at a fractional
          pixel size its softened edge falls just outside the box. The svg
          would clip that edge flat, so its overflow is left visible. */}
      <svg viewBox="0 0 20 20" width="1.05em" height="1.05em" aria-hidden overflow="visible" className={`shrink-0 ${dot}`}>
        <circle cx="10" cy="10" r="10" fill="currentColor" />
        {status === "helpful" && (
          <path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {status === "not_helpful" && (
          <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
      <span>{label}</span>
    </div>
  );
}

/** Common Notes keeps a note's citations in a separate column. We append their
 *  URLs to the note text so they render as links inside it, the way the review
 *  dashboard and the stats dashboard render a note. A note stores one source
 *  row per supporting quote, so the same URL can appear on several rows when
 *  several passages of one document back the note. The link is shown once;
 *  the individual quotes live behind "Source details". */
function noteText(note: NoteRow): string {
  const urls = [...new Set(note.sources.map((s) => s.url))];
  return urls.length > 0 ? `${note.note} ${urls.join(" ")}` : note.note;
}

/** The supporting quote and the explanation for each source, revealed by the
 *  "Source details" button. The source URLs already sit inline in the note
 *  text, so this shows only the body of each citation. Each quote links out to
 *  that passage in the source.
 *
 *  The quotes are the largest thing a note carries and most readers never open
 *  this, so the feed loads without them and this fetches them the first time it
 *  is opened. */
function SourceDetails({ open, noteId }: { open: boolean; noteId: string }) {
  // The query starts the first time the reveal opens and keeps its answer, so
  // closing and opening again costs nothing.
  const [requested, setRequested] = useState(open);
  if (open && !requested) setRequested(true);
  const detailed = useQuery({
    queryKey: queryKeys.sourceDetails(noteId),
    queryFn: () => fetchNoteSourceDetails(noteId),
    enabled: requested,
  }).data ?? [];
  return (
    <div
      style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 300ms ease" }}
      aria-hidden={!open}
    >
      <div className="overflow-hidden min-h-0">
        <div className="mt-3 space-y-3">
          {detailed.map((s, i) => (
            <div key={i}>
              <a href={quoteFragmentUrl(s.url, s.quote)} target="_blank" rel="noopener noreferrer" className="block group">
                <Quote className="group-hover:border-focus">“{s.quote}”</Quote>
              </a>
              {s.explanation && <p className="mt-1 text-xs text-fg-muted">{s.explanation}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The note, laid out like a Community Note on X: the status line, the note
 *  text with its source links, and then a softly filled rating panel that asks
 *  the question beside the pills. `children` are the pills. `question`
 *  replaces the plain question, which is how the one-time voting hint joins
 *  the panel without covering the note. */
export function NoteBox({ note, status, sourcesOpen, question, children }: {
  note: NoteRow;
  status: NoteStatus;
  sourcesOpen?: boolean;
  question?: React.ReactNode;
  children?: React.ReactNode;
}) {
  // A note without an author was written by the pipeline. Saying so is part of
  // "AI writes, people rate": a reader should never mistake a machine's note
  // for a person's.
  const byline = note.author_id ? `by ${note.author_name ?? "anonymous"}` : "Written by AI";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <StatusBadge status={status} />
        <span className="text-xs text-fg-muted shrink-0">{byline}</span>
      </div>
      <LinkifiedText className="text-sm text-fg whitespace-pre-wrap" linkClassName="text-link hover:underline break-all" text={noteText(note)} />
      {note.has_source_details && <SourceDetails open={!!sourcesOpen} noteId={note.id} />}
      {children && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card bg-surface-muted px-4 py-3">
          <div className="text-sm text-fg">{question ?? <span className="font-semibold">{ratingQuestion("note")}</span>}</div>
          {children}
        </div>
      )}
    </div>
  );
}
