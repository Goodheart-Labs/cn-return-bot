import { LinkifiedText } from "./LinkifiedText";

// A note rendered in a soft blue box — note text with clickable URLs. Shared by
// the review/stats dashboards and the Common Notes site. Renders nothing without
// note text.
export function OurNoteCard({
  noteText,
  className,
}: {
  noteText?: string;
  className?: string;
}) {
  if (!noteText) return null;

  const containerClasses = ["bg-blue-50 rounded p-3 border border-blue-100", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClasses}>
      <LinkifiedText className="text-sm text-gray-800 whitespace-pre-wrap" text={noteText} />
    </div>
  );
}
