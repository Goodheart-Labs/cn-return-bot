import { cn } from "./cn";
import { focusRing } from "./focusRing";

/** A row of buttons of which exactly one is picked, like the order of a list.
 *  It is a radio group for screen readers. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: {
  /** What the choice is about, read out by screen readers. */
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-control border border-line bg-surface-muted p-0.5">
      {options.map(({ id, label: optionLabel }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "whitespace-nowrap rounded-[calc(var(--cn-radius-control)-2px)] px-3 py-1 text-sm font-medium text-fg-secondary",
            focusRing,
            value === id ? "bg-surface text-fg shadow-raised" : "hover:text-fg",
          )}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}
