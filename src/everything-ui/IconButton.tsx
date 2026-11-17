import type { ReactNode } from "react";
import { cn } from "./cn";
import { focusRing } from "./focusRing";

/** A square button that shows only an icon: the close and overflow buttons on
 *  cards, menus and modals. A fixed 24px hit target, quiet at rest, a subtle
 *  fill on hover. The label is its accessible name and its tooltip. */
export function IconButton({ label, onClick, disabled, className, children }: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control leading-none text-fg-subtle hover:bg-surface-hover hover:text-fg-secondary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle",
        focusRing,
        className,
      )}
    >
      {children}
    </button>
  );
}
