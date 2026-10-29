import { useId } from "react";
import { cn } from "./cn";
import { focusRing } from "./focusRing";

/** A labelled slider that picks a whole number from 0 to `max`, drawn by the
 *  browser's own range input in the product's primary colour. The current
 *  value is shown next to the label, written by `formatValue`. The arrow keys
 *  move it one step at a time. */
export function Slider({ label, value, max, onChange, formatValue = String }: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <label htmlFor={id} className="font-medium text-fg-secondary">{label}</label>
        <span className="tabular-nums text-fg">{formatValue(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        className={cn("block w-full accent-primary", focusRing)}
      />
    </div>
  );
}
