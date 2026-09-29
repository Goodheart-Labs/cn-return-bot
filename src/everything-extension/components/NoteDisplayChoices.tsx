import { useEffect, useState } from "react";
import type { NoteStatus } from "@cn/core/noteScore";
import { getNoteDisplay, onNoteDisplayChanged, updateNoteDisplay, type NoteDisplay, type NoteDisplaySettings } from "../utils/settings";

/** The note display choices as editable state. A change is written to synced
 *  storage, and every page and overlay that reads them follows it straight
 *  away, including a change made in another part of the extension. */
export function useNoteDisplay(): [NoteDisplaySettings | null, (patch: Partial<NoteDisplaySettings>) => void] {
  const [display, setDisplay] = useState<NoteDisplaySettings | null>(null);
  useEffect(() => {
    const load = () => void getNoteDisplay().then(setDisplay);
    load();
    return onNoteDisplayChanged(load);
  }, []);
  const change = (patch: Partial<NoteDisplaySettings>) => {
    setDisplay((prev) => (prev ? { ...prev, ...patch } : prev));
    void updateNoteDisplay(patch);
  };
  return [display, change];
}

const STATUS_ROWS: { status: NoteStatus; label: string }[] = [
  { status: "helpful", label: "Notes rated helpful" },
  { status: "needs_ratings", label: "Notes that need more ratings" },
  { status: "not_helpful", label: "Notes rated not helpful" },
];

const DISPLAY_OPTIONS: { value: NoteDisplay; label: string }[] = [
  { value: "show", label: "Show" },
  { value: "collapse", label: "Collapse" },
  { value: "hide", label: "Hide" },
];

/** One group per note status, each with the three display choices as radio
 *  buttons, like the other radio choices on the settings page. */
export function NoteDisplayChoices({ display, onChange }: {
  display: NoteDisplaySettings;
  onChange: (patch: Partial<NoteDisplaySettings>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-secondary">
        How notes appear on the page. A collapsed note shows only a small, faint marker, and opens when you click it.
      </p>
      {STATUS_ROWS.map(({ status, label }) => (
        <fieldset key={status} className="space-y-1">
          <legend className="text-sm text-fg">{label}</legend>
          <div className="flex gap-4">
            {DISPLAY_OPTIONS.map(({ value, label: optionLabel }) => (
              <label key={value} className="flex items-center gap-1.5 text-sm text-fg-secondary">
                <input
                  type="radio"
                  className="accent-primary"
                  name={`note-display-${status}`}
                  checked={display[status] === value}
                  onChange={() => onChange({ [status]: value })}
                />
                {optionLabel}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
