import { createContext, useContext, type ReactNode } from "react";
import { ChevronIcon } from "@cn/ui/icons";
import { useReader } from "./context";

/** The colour of an entry's dot: a note's status, or a reader highlight. */
export type DotTone = "helpful" | "needs-ratings" | "not-helpful" | "highlight" | "request";

/** The order in which entries of one passage claim the room beside it. Lower
 *  goes first: a helpful note before a note that needs ratings, an AI note
 *  before a reader's, and notes before key points and forecasts. */
export const SLOT_PRIORITY = { request: 0, helpful: 0, aiNote: 1, readerNote: 2, highlight: 3, notHelpful: 4 } as const;

const SlotKeyContext = createContext<string | null>(null);

/** The key of the margin slot a card sits in, for the card's close button. */
export function useSlotKey(): string {
  const key = useContext(SlotKeyContext);
  if (!key) throw new Error("useSlotKey is only available inside a MarginSlot");
  return key;
}

/** One entry in the margin: a card, or the dot it shrinks to. On wide screens
 *  the margin layout decides which one shows and where. On narrow screens
 *  there is no margin, so a closed entry is one line under the passage. */
export function MarginSlot({ slotKey, tone, priority, label, children }: {
  slotKey: string;
  tone: DotTone;
  priority: number;
  /** What the dot and the closed line say, such as "Note · Needs more ratings". */
  label: string;
  children: ReactNode;
}) {
  const { wide, slotMode, openEntry } = useReader();
  const mode = slotMode(slotKey);
  if (!wide && mode === "closed") {
    return <div className="reader-entry">
      <button type="button" className="reader-entry-closed" aria-expanded={false} onClick={() => openEntry(slotKey)}>
        <span className="reader-entry-closed-kind">{label}</span>
        <ChevronIcon size={16} aria-hidden />
      </button>
    </div>;
  }
  return <SlotKeyContext.Provider value={slotKey}>
    <div className="reader-slot" data-slot={slotKey} data-mode={mode} data-priority={priority}>
      {wide && <button type="button" className={`reader-dot reader-dot-${tone}`} aria-label={`Open ${label}`} title={label} onClick={() => openEntry(slotKey)} />}
      <div className="reader-slot-card">{children}</div>
    </div>
  </SlotKeyContext.Provider>;
}
