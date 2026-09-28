import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNoteSourceDetails } from "@cn/core/notes";
import type { NoteStatus } from "@cn/core/noteScore";
import type { NoteRow } from "@cn/core/types";
import { QUOTE_RAIL } from "@cn/ui/classes";
import { LinkifiedText } from "../../dashboard-shared/LinkifiedText";
import { quoteFragmentUrl } from "../../dashboard-shared/textFragment";
import { queryKeys } from "../query/queryKeys";

/** The rating states, in the style of Community Notes. Each one carries the
 *  colour of its icon, the copy on its badge, the tint of the note box, and the
 *  question asked in the footer. The design sits halfway to X's own Community
 *  Notes grammar (Nathan, 2026-07-14). The badge and the wording are ours, and
 *  the vote row asks one plain question. */
const STATUS: Record<NoteStatus, { label: string; color: string; box: string; ask: string }> = {
  helpful: { label: "Currently rated helpful", color: "#22c55e", box: "bg-blue-50 border-blue-100 dark:bg-blue-950/50 dark:border-blue-900", ask: "Do you find this helpful?" },
  not_helpful: { label: "Currently rated not helpful", color: "#ef4444", box: "bg-gray-100 border-gray-200 dark:bg-gray-800/60 dark:border-gray-700", ask: "Do you find this helpful?" },
  needs_ratings: { label: "Needs more ratings", color: "#9ca3af", box: "bg-blue-50 border-blue-100 dark:bg-blue-950/50 dark:border-blue-900", ask: "Is this note helpful?" },
};

/** The status badge shown above a note. It is a filled circle followed by the
 *  Community Notes copy for that status. A status that has been decided also
 *  draws a ✓ or a ✕ inside the circle. */
export function StatusBadge({ status }: { status: NoteStatus }) {
  const { label, color } = STATUS[status];
  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
      {/* The size is given in em so the icon scales with the site's larger
          type scale. */}
      <svg viewBox="0 0 20 20" width="1.05em" height="1.05em" aria-hidden className="shrink-0">
        <circle cx="10" cy="10" r="10" fill={color} />
        {status === "helpful" && (
          <path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {status === "not_helpful" && (
          <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
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
 *  the individual quotes live behind "Show source details". */
function noteText(note: NoteRow): string {
  const urls = [...new Set(note.sources.map((s) => s.url))];
  return urls.length > 0 ? `${note.note} ${urls.join(" ")}` : note.note;
}

/** The supporting quote and the explanation for each source, revealed by the
 *  "Show source details" button. The source URLs already sit inline in the note
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
                <blockquote className={`${QUOTE_RAIL} group-hover:border-blue-400 text-sm italic text-gray-600 dark:text-gray-300`}>“{s.quote}”</blockquote>
              </a>
              {s.explanation && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{s.explanation}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The note as one self-contained unit, in the style of X's Community Notes. The
 *  rating-status badge sits on top, then the note text, then the rating pills,
 *  all inside the same box. The tint of the box follows the note's status. */
export function NoteBox({ note, status, sourcesOpen, children }: {
  note: NoteRow;
  status: NoteStatus;
  sourcesOpen?: boolean;
  children?: React.ReactNode;
}) {
  const by = note.author_id ? note.author_name ?? "anonymous" : null;
  return (
    <div className={`cn-notebox rounded-lg p-3 border ${STATUS[status].box}`}>
      <div className="-mx-3 px-3 pb-2 mb-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
        <StatusBadge status={status} />
        {by && <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">by {by}</span>}
      </div>
      <LinkifiedText className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap" text={noteText(note)} />
      {note.has_source_details && <SourceDetails open={!!sourcesOpen} noteId={note.id} />}
      {children && (
        <div className="-mx-3 mt-3 px-3 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-x-4 gap-y-1">
          <span className="text-sm text-gray-600 dark:text-gray-300">{STATUS[status].ask}</span>
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">{children}</div>
        </div>
      )}
    </div>
  );
}
