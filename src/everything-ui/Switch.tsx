import { cn } from "./cn";
import { focusRing } from "./focusRing";

/** An on and off switch with its label before it, such as Developer mode. The
 *  whole row is one button, so a click on the label flips it too. */
export function Switch({ label, checked, onChange, className }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn("inline-flex select-none items-center gap-2 rounded-control text-sm font-medium text-fg-secondary", focusRing, className)}
    >
      {label}
      <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-line-strong")}>
        <span className={cn("absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-raised transition-transform", checked && "translate-x-4")} />
      </span>
    </button>
  );
}
