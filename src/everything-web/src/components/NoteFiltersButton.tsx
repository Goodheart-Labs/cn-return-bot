import { useEffect, useRef, useState } from "react";
import { Button } from "@cn/ui/Button";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { Checkbox } from "@cn/ui/Field";
import { Slider } from "@cn/ui/Slider";
import { useOutsidePress } from "@cn/ui/useOutsidePress";
import { DEFAULT_NOTE_FILTERS, type NoteFilters, type NoteMinimums } from "../lib/feed";

const SLIDERS: { key: keyof NoteMinimums; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "votes", label: "Votes" },
  { key: "helpful", label: "Helpful votes" },
  { key: "notHelpful", label: "Not helpful votes" },
];

/** A slider's end is the largest value any note has. While every note has a
 *  small value, the end stays at this number, so the slider still moves in
 *  visible steps. */
const SMALLEST_SLIDER_END = 10;

/** A Filters button that opens a popover with a checkbox that hides the notes
 *  the reader voted on, and one minimum slider per vote or view count.
 *  A second click on the button, a press outside the popover, or Escape closes
 *  it. The page does not close it on scroll, because filtering changes the
 *  feed's length and the page can scroll by itself while a slider is dragged.
 *  The button counts the filters that are switched on: the checkbox when it is
 *  ticked, and each slider above zero.
 *  The popover hangs below the nearest positioned ancestor, which the page
 *  picks. On a phone it spans that ancestor's whole width, because the button
 *  may have wrapped to the left edge. On a wider screen it sits at the right. */
export function NoteFiltersButton({ filters, onChange, largest, matchingNotes }: {
  filters: NoteFilters;
  onChange: (filters: NoteFilters) => void;
  /** The largest value of each minimum among all notes, before filtering. */
  largest: NoteMinimums;
  matchingNotes: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useOutsidePress(ref, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const activeCount = SLIDERS.filter(({ key }) => filters[key] > 0).length + Number(filters.unvotedOnly);

  return (
    <div ref={ref}>
      <Button ref={buttonRef} variant="secondary" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((wasOpen) => !wasOpen)}>
        {activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
      </Button>
      {open && (
        <div role="dialog" aria-label="Filters" className={cn(cardVariants({ elevation: "floating" }), "absolute inset-x-0 top-full z-20 mt-2 space-y-4 p-4 sm:left-auto sm:w-72")}>
          <Checkbox checked={filters.unvotedOnly} onChange={(unvotedOnly) => onChange({ ...filters, unvotedOnly })} className="text-sm font-medium text-fg-secondary">
            Only notes I haven't voted on
          </Checkbox>
          {SLIDERS.map(({ key, label }) => (
            <Slider
              key={key}
              label={label}
              value={filters[key]}
              // A remembered minimum can be above every note's value, and the
              // slider must still be able to show it.
              max={Math.max(largest[key], filters[key], SMALLEST_SLIDER_END)}
              onChange={(value) => onChange({ ...filters, [key]: value })}
              formatValue={(value) => `${value}+`}
            />
          ))}
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-fg-muted">{matchingNotes === 1 ? "1 note" : `${matchingNotes} notes`}</span>
            <Button variant="link" onClick={() => onChange(DEFAULT_NOTE_FILTERS)}>Reset</Button>
          </div>
        </div>
      )}
    </div>
  );
}
