import type { ReactNode } from "react";
import { cn } from "@cn/ui/cn";
import { DropdownMenu, type MenuEntry } from "@cn/ui/DropdownMenu";
import { CloseIcon } from "@cn/ui/icons";

/** The look of the pills of the Filter and Sort bars, and of their buttons. */
const pillClass = "inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-surface text-sm font-medium text-fg";

/** A pill that is one button, such as Filter or Display. */
export const pillButtonClass = cn(pillClass, "px-3 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus");

/** One active filter or sort level as a pill. A click on it opens its menu
 *  again to change it. The cross on the pill's right removes it. It is always
 *  shown in a muted colour and darkens when the pointer is on it. `extra` sits
 *  between the two, such as a sort's direction. */
export function QueryChip({ label, menu, menuLabel, removeLabel, onRemove, extra }: {
  label: ReactNode;
  menu: MenuEntry[];
  menuLabel: string;
  removeLabel: string;
  onRemove: () => void;
  extra?: ReactNode;
}) {
  return (
    <span className={cn(pillClass, "pl-3 pr-1")}>
      <DropdownMenu
        label={menuLabel}
        entries={menu}
        trigger={
          <button type="button" className="-ml-1.5 max-w-64 truncate rounded-full px-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {label}
          </button>
        }
      />
      {extra}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="flex h-6 w-6 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:text-fg focus-visible:ring-2 focus-visible:ring-focus"
      >
        <CloseIcon size={12} aria-hidden />
      </button>
    </span>
  );
}
