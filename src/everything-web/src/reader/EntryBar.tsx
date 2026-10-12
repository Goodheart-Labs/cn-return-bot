import { NextNoteButton } from "@cn/features/notes/NextNoteButton";
import { IconButton } from "@cn/ui/IconButton";
import { CloseIcon, ChevronIcon } from "@cn/ui/icons";
import { useReader } from "./context";

/** The controls in the bar at the top of a margin card: "N of M ›" on the
 *  left, the close button on the right, as on the extension's note cards.
 *  The card supplies the bar's row. */
export function EntryBar({ elementId, kind }: { elementId: string; kind: string }) {
  const { entryNavigation, setCollapsed } = useReader();
  const navigation = entryNavigation(elementId);
  return <>
    {navigation && <NextNoteButton {...navigation} />}
    <IconButton label={`Close ${kind}`} className="-mr-1.5 ml-auto" onClick={() => setCollapsed(elementId, true)}>
      <CloseIcon size={14} aria-hidden />
    </IconButton>
  </>;
}

/** A closed card: one line that keeps its place in the margin and opens the
 *  card again. Closing frees the room for the cards below it. */
export function ClosedEntry({ elementId, kind, detail }: { elementId: string; kind: string; detail: string }) {
  const { setCollapsed } = useReader();
  return <div id={elementId} className="reader-entry">
    <button type="button" className="reader-entry-closed" aria-expanded={false} onClick={() => setCollapsed(elementId, false)}>
      <span className="reader-entry-closed-kind">{kind}</span><span aria-hidden="true">·</span>
      <span className="reader-entry-closed-detail">{detail}</span>
      <ChevronIcon size={16} aria-hidden />
    </button>
  </div>;
}
