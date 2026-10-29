import type { ReactNode } from "react";
import { cn } from "./cn";
import { DropdownMenu, type MenuEntry } from "./DropdownMenu";
import { fieldClass } from "./Field";
import { ChevronIcon } from "./icons";

/** A small label and a button that shows the current choice, such as
 *  "Window: Last 30 days". The button opens a menu of the choices, which may
 *  hold submenus. */
export function PickerButton({ label, value, entries }: { label: string; value: ReactNode; entries: MenuEntry[] }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs font-semibold text-fg-muted">{label}</span>
      <DropdownMenu
        label={label}
        entries={entries}
        trigger={
          <button type="button" className={cn(fieldClass, "inline-flex max-w-72 items-center gap-1.5 py-1")}>
            <span className="truncate">{value}</span>
            <ChevronIcon size={16} aria-hidden className="shrink-0 rotate-90 text-fg-muted" />
          </button>
        }
      />
    </div>
  );
}
