import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const FIELD = "rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** A one-line text field. */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(FIELD, className)} {...props} />;
}

/** A multi-line text field. With `autoGrow` it grows with its text instead of
 *  scrolling, which suits the short composers under a note. */
export function Textarea({ autoGrow, className, ...props }: ComponentProps<"textarea"> & { autoGrow?: boolean }) {
  return (
    <textarea
      ref={autoGrow ? (el) => {
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      } : undefined}
      className={cn(FIELD, "w-full", autoGrow && "resize-none overflow-hidden", className)}
      {...props}
    />
  );
}

/** A checkbox with its label. */
export function Checkbox({ checked, onChange, disabled, className, children }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex items-center gap-2 cursor-pointer", className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary"
      />
      {children}
    </label>
  );
}
