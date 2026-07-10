import { LinkifiedText } from "./LinkifiedText";
import { communityNoteUrl } from "./communityNoteUrl";
import { sourceLinkLabel } from "./sourceLabel";

// A note rendered in a soft blue box — note text with clickable URLs, and a
// top-right row of compact "hostname ↗" links: the note's sources (Common Notes
// stores citations in a separate column rather than inline) and a "View note"
// permalink when a noteId is given (the dashboards pass one; the Common Notes
// site doesn't). Shared everywhere; renders nothing without text.
export function OurNoteCard({
  noteId,
  noteText,
  sources,
  className,
}: {
  noteId?: string;
  noteText?: string;
  sources?: string[];
  className?: string;
}) {
  if (!noteText) return null;

  const containerClasses = ["bg-blue-50 rounded p-3 border border-blue-100", className]
    .filter(Boolean)
    .join(" ");
  const uniqueSources = sources ? [...new Set(sources)] : [];

  return (
    <div className={containerClasses}>
      {(noteId || uniqueSources.length > 0) && (
        <div className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 mb-1">
          {uniqueSources.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              {sourceLinkLabel(url)} ↗
            </a>
          ))}
          {noteId && (
            <a
              href={communityNoteUrl(noteId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              View note ↗
            </a>
          )}
        </div>
      )}
      <LinkifiedText className="text-sm text-gray-800 whitespace-pre-wrap" text={noteText} />
    </div>
  );
}
