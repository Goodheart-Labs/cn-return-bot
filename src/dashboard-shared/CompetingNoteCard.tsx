import { LinkifiedText } from "./LinkifiedText";
import { communityNoteUrl } from "./communityNoteUrl";

const STATUS_COLORS: Record<string, string> = {
  CURRENTLY_RATED_HELPFUL: "bg-green-100 text-green-800",
  CURRENTLY_RATED_NOT_HELPFUL: "bg-red-100 text-red-800",
  NEEDS_MORE_RATINGS: "bg-blue-100 text-blue-800",
};

export function NoteStatusBadge({ status }: { status?: string }) {
  const display = status ?? "unknown";
  const color = STATUS_COLORS[display] ?? "bg-gray-100 text-gray-600";
  const label = display.replace(/CURRENTLY_RATED_/g, "").replace(/_/g, " ");
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>;
}

// A community note NOT written by us (competitor or missed-opportunity): a gray
// card with the note's rating status and a permalink. Shared by the review
// dashboard (comparison notes) and the similarity panel (notes on similar tweets).
export function CompetingNoteCard({
  noteId,
  noteText,
  status,
}: {
  noteId: string;
  noteText?: string;
  status?: string;
}) {
  return (
    <div className="bg-gray-50 rounded p-3 text-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-1">
        <NoteStatusBadge status={status} />
        <a
          href={communityNoteUrl(noteId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline ml-auto"
        >
          View note ↗
        </a>
      </div>
      <LinkifiedText className="text-gray-700 whitespace-pre-wrap" text={noteText ?? "No text"} />
    </div>
  );
}
