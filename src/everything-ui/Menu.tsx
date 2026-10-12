import type { ReactNode } from "react";
import { cn } from "./cn";
import { cardVariants } from "./Card";

/** A dropdown menu's floating panel. Its rows are MenuItems. */
export function Menu({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(cardVariants({ elevation: "floating" }), "w-56 p-1.5 text-sm", className)}>{children}</div>;
}

/** One row of a menu. A row marked as danger turns red, which is how a
 *  destructive action such as Delete is set apart from the rest. `selected`
 *  marks the current choice of a picker. */
export function MenuItem({ onClick, icon, danger, selected, autoFocus, children }: {
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
  selected?: boolean;
  /** Focus this row as soon as it mounts. The browser scrolls a newly focused
   *  element into view, and that is what reveals a menu opening below the
   *  fold of the extension's popover. */
  autoFocus?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus={autoFocus}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2 text-left px-2 py-2 rounded-control font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        danger ? "text-negative hover:bg-negative-soft" : "text-fg-secondary hover:bg-surface-hover",
        selected && "text-link",
      )}
    >
      {icon && <span className={cn("shrink-0", danger ? "text-negative" : "text-fg-subtle")} aria-hidden>{icon}</span>}
      {children}
    </button>
  );
}
