import { createContext, useContext, useRef, type ReactNode } from "react";
import { MarginDot } from "@cn/features/margin/MarginDot";
import { ChevronIcon } from "@cn/ui/icons";
import { useReader } from "./context";

/** The dot colours of the entries that are not notes. A note's dot takes the
 *  colour of its status, as in the extension. */
export const HIGHLIGHT_DOT = "text-caution-solid";
export const REQUEST_DOT = "text-fg-subtle";
export const ASK_DOT = "text-fg-muted";

/** The order in which entries whose words start on the same line claim the
 *  room beside them. Lower goes first: a helpful note before a note that needs
 *  ratings, an AI note before a reader's, and notes before key points and
 *  forecasts. */
export const SLOT_PRIORITY = { request: 0, helpful: 0, aiNote: 1, readerNote: 2, highlight: 3, notHelpful: 4, ask: 5 } as const;

const SlotKeyContext = createContext<string | null>(null);

/** The key of the margin slot a card sits in, for the card's close button. */
export function useSlotKey(): string {
  const key = useContext(SlotKeyContext);
  if (!key) throw new Error("useSlotKey is only available inside a MarginSlot");
  return key;
}

/** One entry in the margin: a card, or the extension's dot it shrinks to. On
 *  wide screens the margin layout decides which one shows and where. On
 *  narrow screens there is no margin, so a closed entry is one line under
 *  the passage. */
export function MarginSlot({ slotKey, colorClass, priority, label, onOpen, onClose, closedUntilOpened, busy, children }: {
  slotKey: string;
  /** The text colour class the dot is drawn in. */
  colorClass: string;
  priority: number;
  /** What the dot and the closed line say, such as "Note · Needs more ratings". */
  label: string;
  /** An entry that opens somewhere else, such as a sheet on a phone, has no
   *  card. It is always closed, and this runs when it is clicked. */
  onOpen?: () => void;
  /** Runs when the reader clicks the dot while its card shows beside it.
   *  By default the entry closes. */
  onClose?: () => void;
  /** The card never opens by itself. It shows only once the reader opens it. */
  closedUntilOpened?: boolean;
  /** Something is under way, such as Opus answering, so the dot pulses. */
  busy?: boolean;
  children?: ReactNode;
}) {
  const { wide, slotMode, openedRank, openEntry, closeEntry } = useReader();
  // The margin layout writes whether the card shows straight onto the slot.
  const slot = useRef<HTMLDivElement>(null);
  const storedMode = slotMode(slotKey);
  const mode = onOpen || (closedUntilOpened && storedMode === "auto") ? "closed" : storedMode;
  const open = onOpen ?? (() => openEntry(slotKey));
  // A dot stays visible beside its open card, and a second click closes it.
  const toggle = () => (slot.current?.dataset.shown === "card" ? (onClose ?? (() => closeEntry(slotKey)))() : open());
  if (!wide && mode === "closed") {
    return <div className="reader-entry">
      <button type="button" className="reader-entry-closed" aria-expanded={false} onClick={open}>
        <span className="reader-entry-closed-kind">{label}</span>
        <ChevronIcon size={16} aria-hidden />
      </button>
    </div>;
  }
  return <SlotKeyContext.Provider value={slotKey}>
    <div ref={slot} className="reader-slot" data-slot={slotKey} data-mode={mode} data-priority={priority} data-opened-rank={openedRank(slotKey)} data-busy={busy || undefined}>
      {wide && <MarginDot className="reader-dot" colorClass={colorClass} open={false} label={label} onClick={toggle} />}
      <div className="reader-slot-card">{children}</div>
    </div>
  </SlotKeyContext.Provider>;
}
