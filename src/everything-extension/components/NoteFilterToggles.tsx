import { useEffect, useState } from "react";
import { Checkbox } from "@cn/ui/Field";
import { getNoteFilters, onNoteFiltersChanged, updateNoteFilters, type NoteFilters } from "../utils/settings";

/** The note filters as editable state. A change is written to synced storage,
 *  and every page and overlay that reads the filters follows it straight
 *  away, including a change made in another part of the extension. */
export function useNoteFilters(): [NoteFilters | null, (patch: Partial<NoteFilters>) => void] {
  const [filters, setFilters] = useState<NoteFilters | null>(null);
  useEffect(() => {
    const load = () => void getNoteFilters().then(setFilters);
    load();
    return onNoteFiltersChanged(load);
  }, []);
  const toggle = (patch: Partial<NoteFilters>) => {
    setFilters((prev) => (prev ? { ...prev, ...patch } : prev));
    void updateNoteFilters(patch);
  };
  return [filters, toggle];
}

export function NoteFilterToggles({ filters, onToggle }: { filters: NoteFilters; onToggle: (patch: Partial<NoteFilters>) => void }) {
  return (
    <div className="space-y-2">
      <Checkbox className="text-sm text-fg-secondary" checked={filters.showNeedsRatings} onChange={(checked) => onToggle({ showNeedsRatings: checked })}>
        Show notes that need more ratings
      </Checkbox>
      <Checkbox className="text-sm text-fg-secondary" checked={filters.showUnhelpful} onChange={(checked) => onToggle({ showUnhelpful: checked })}>
        Show unhelpful notes
      </Checkbox>
    </div>
  );
}
