import { LinkifiedText } from "./LinkifiedText";
import { communityNoteUrl } from "./communityNoteUrl";

// Hostname without a leading "www." for a compact source label; falls back to
// the raw URL if it doesn't parse.
function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// A note rendered in a soft blue box — note text with clickable URLs, an
// optional "Sources" footer (Common Notes stores citations in a separate
// column rather than inline), plus a "View note" permalink when a noteId is
// given (the dashboards pass one; the Common Notes site doesn't). Shared
// everywhere; renders nothing without text.
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
      {uniqueSources.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-blue-100 pt-2">
          <span className="text-xs font-medium text-gray-500">Sources</span>
          {uniqueSources.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline break-all"
            >
              {sourceLabel(url)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
