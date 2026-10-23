import { Button } from "@cn/ui/Button";
import { Checkbox } from "@cn/ui/Field";
import { Slider } from "@cn/ui/Slider";
import { DEFAULT_NOTE_FILTERS, type NoteFilters, type NoteMinimums } from "../lib/feed";
import { FiltersPopover } from "./FiltersPopover";

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

/** The All notes page's filters: a checkbox that hides the notes the reader
 *  voted on, and one minimum slider per vote or view count. The button counts
 *  the checkbox when it is ticked, and each slider above zero. */
export function NoteFiltersButton({ filters, onChange, largest, matchingNotes }: {
  filters: NoteFilters;
  onChange: (filters: NoteFilters) => void;
  /** The largest value of each minimum among all notes, before filtering. */
  largest: NoteMinimums;
  matchingNotes: number;
}) {
  const activeCount = SLIDERS.filter(({ key }) => filters[key] > 0).length + Number(filters.unvotedOnly);

  return (
    <FiltersPopover activeCount={activeCount}>
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
    </FiltersPopover>
  );
}
