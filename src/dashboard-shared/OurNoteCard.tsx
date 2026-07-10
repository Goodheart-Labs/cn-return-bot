import { LinkifiedText } from "./LinkifiedText";
import { communityNoteUrl } from "./communityNoteUrl";

// A note rendered in a soft blue box — note text with clickable URLs, plus a
// "View note" permalink when a noteId is given (the dashboards pass one; the
// Common Notes site doesn't). Shared everywhere; renders nothing without text.
export function OurNoteCard({
  noteId,
  noteText,
  className,
}: {
  noteId?: string;
  noteText?: string;
  className?: string;
}) {
  if (!noteText) return null;

  const containerClasses = ["bg-blue-50 rounded p-3 border border-blue-100", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses}>
      {noteId && (
        <div className="flex justify-end mb-1">
          <a
            href={communityNoteUrl(noteId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            View note ↗
          </a>
        </div>
      )}
      <LinkifiedText className="text-sm text-gray-800 whitespace-pre-wrap" text={noteText} />
    </div>
  );
}
