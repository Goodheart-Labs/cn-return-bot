import { NextIcon } from "@cn/ui/icons";

/** Where a card sits among the page's cards, and how to move on to the next
 *  one. Positions count from 1. */
export interface NoteNavigation {
  position: number;
  total: number;
  onNext: () => void;
}

/** The card's place among the page's cards, as "3 of 8 ›". It sits in the
 *  card's top bar, and clicking it moves on to the next card. A page with one
 *  card has nowhere to move on to, so the button is left out. The extension's
 *  note overlays and the website's article reader both use it. */
export function NextNoteButton({ position, total, onNext }: NoteNavigation) {
  if (total <= 1) return null;
  return (
    <button
      type="button"
      onClick={onNext}
      aria-label={`Next note. This is note ${position} of ${total}`}
      className="-ml-1.5 inline-flex h-6 items-center gap-0.5 rounded-control px-1.5 text-sm tabular-nums text-fg-muted hover:bg-surface-hover hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      {position} of {total}
      <NextIcon size={14} aria-hidden />
    </button>
  );
}
