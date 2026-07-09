import { LinkifiedText } from "./LinkifiedText";
import { communityNoteUrl } from "./communityNoteUrl";

// The note block shared by the review/stats dashboards and the Common Notes
// site: the note text (with clickable URLs) plus a permalink. Renders nothing
// without note text.
export function OurNoteCard({
  noteId,
  noteText,
  className,
  label = "Our note",
}: {
  noteId?: string;
  noteText?: string;
  className?: string;
  label?: string;
}) {
  if (!noteText) return null;

  const containerClasses = ["bg-blue-50 rounded p-3 border border-blue-100", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-blue-600 font-medium">{label}</span>
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
      <LinkifiedText className="text-sm text-gray-800 whitespace-pre-wrap" text={noteText} />
    </div>
  );
}
