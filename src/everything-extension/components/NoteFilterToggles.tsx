import { useEffect, useState } from "react";
import { getNoteFilters, updateNoteFilters, type NoteFilters } from "../utils/settings";

/** The note filters as editable state. A change is written to synced storage,
 *  and the content scripts watch that storage so open pages re-render straight
 *  away. */
export function useNoteFilters(): [NoteFilters | null, (patch: Partial<NoteFilters>) => void] {
  const [filters, setFilters] = useState<NoteFilters | null>(null);
  useEffect(() => {
    getNoteFilters().then(setFilters);
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
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={filters.showNeedsRatings}
          onChange={(e) => onToggle({ showNeedsRatings: e.target.checked })}
        />
        Show notes that need more ratings
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={filters.showUnhelpful}
          onChange={(e) => onToggle({ showUnhelpful: e.target.checked })}
        />
        Show unhelpful notes
      </label>
    </div>
  );
}
