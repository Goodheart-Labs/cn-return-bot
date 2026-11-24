import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";
import { NextIcon } from "@cn/ui/icons";

/** Where a card sits among the page's cards, and how to move on to the next
 *  one. Positions count from 1. */
export interface NoteNavigation {
  position: number;
  total: number;
  onNext: () => void;
  /** What the total counts across. "1 of 3" alone read as three notes on
   *  this one claim, so the counter names it: "on this page" unless the
   *  caller says otherwise. */
  where?: string;
}

/** The card's place among the page's cards, as "3 of 8 on this page ›". It sits in the
 *  card's top bar, and clicking it moves on to the next card. A page with one
 *  card has nowhere to move on to, so the button is left out. The extension's
 *  note overlays and the website's article reader both use it. */
export function NextNoteButton({ position, total, onNext, where = "on this page" }: NoteNavigation) {
  if (total <= 1) return null;
  return (
    <button
      type="button"
      onClick={onNext}
      aria-label={`Next note. This is note ${position} of ${total} ${where}`}
      className={cn("-ml-1.5 inline-flex h-6 items-center gap-0.5 rounded-control px-1.5 text-sm tabular-nums text-fg-muted hover:bg-surface-hover hover:text-fg-secondary", focusRing)}
    >
      {position} of {total} {where}
      <NextIcon size={14} aria-hidden />
    </button>
  );
}
