import { NextNoteButton } from "@cn/features/notes/NextNoteButton";
import { IconButton } from "@cn/ui/IconButton";
import { CloseIcon } from "@cn/ui/icons";
import { useReader } from "./context";
import { useSlotKey } from "./MarginSlot";

/** The controls in the bar at the top of a margin card: "N of M ›" on the
 *  left, the close button on the right, as on the extension's note cards.
 *  The card supplies the bar's row. Closing shrinks the card's whole slot to
 *  its dot, which frees the room for the cards below it. */
export function EntryBar({ elementId, kind, closable = true }: {
  elementId: string;
  kind: string;
  /** Several notes in one slot share one close button, on the first note. */
  closable?: boolean;
}) {
  const { entryNavigation, closeEntry } = useReader();
  const slotKey = useSlotKey();
  const navigation = entryNavigation(elementId);
  return <>
    {navigation && <NextNoteButton {...navigation} />}
    {closable && <IconButton label={`Close ${kind}`} className="-mr-1.5 ml-auto" onClick={() => closeEntry(slotKey)}>
      <CloseIcon size={14} aria-hidden />
    </IconButton>}
  </>;
}
