import { LinkifiedText } from "./LinkifiedText";
import { communityNoteUrl } from "./communityNoteUrl";

// Renders a note in a soft blue box, with every URL in the note text made
// clickable. A "View note" permalink is added when a noteId is given. The
// dashboards pass one and the Common Notes site does not. Nothing is rendered
// when there is no note text.
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
