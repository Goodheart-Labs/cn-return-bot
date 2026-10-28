import * as Radix from "@radix-ui/react-dropdown-menu";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cardVariants } from "./Card";
import { cn } from "./cn";
import { CheckIcon, ChevronIcon } from "./icons";
import { menuItemClass } from "./Menu";

/* A dropdown menu built from a tree of entries. Radix UI's DropdownMenu, a
 * headless library (it brings the behaviour and leaves the looks to us),
 * handles focus, the arrow keys, Escape, typing a letter to jump to an entry,
 * screen-reader roles, and submenus that stay open while the pointer travels
 * to them. This file only turns the tree into Radix parts and styles them.
 *
 * Submenus open to the left, because the menus sit at the right edge of the
 * page. Radix opens them towards the end of the reading direction, so the menu
 * runs right to left and its text is set back to left to right. The arrow keys
 * follow the menu's direction: the left arrow opens a submenu and the right
 * arrow closes it again. Near the screen's left edge a submenu flips to the
 * right. */

/** One choice in a list of options. `text` is what the search box matches when
 *  the label is not plain text. */
export interface MenuOption {
  value: string;
  label: ReactNode;
  text?: string;
  /** Shown when the pointer rests on the option. */
  hint?: string;
  /** How many rows this option would show, set at the right. */
  count?: number;
}

/** One entry of a menu. An action runs and closes the menu. A submenu opens
 *  another menu of entries, and `value` sums up its current state at the
 *  right. A choice is a list of options: a single choice closes the menu on a
 *  pick, a multiple choice stays open so more options can be ticked. */
export type MenuEntry =
  | { type: "action"; key: string; label: ReactNode; icon?: ReactNode; hint?: string; danger?: boolean; onSelect: () => void }
  | { type: "submenu"; key: string; label: ReactNode; hint?: string; value?: ReactNode; entries: MenuEntry[] }
  | { type: "choice"; key: string; multiple: boolean; options: MenuOption[]; selected: readonly string[]; onChange: (selected: string[]) => void }
  | { type: "heading"; key: string; label: ReactNode }
  | { type: "separator"; key: string };

/** A choice with more options than this gets a search box above them. */
const SEARCH_FROM_OPTIONS = 12;

/** The floating panel of a menu or submenu. It never grows past the space the
 *  screen has left, and scrolls when its entries need more. */
const panelClass = cn(
  cardVariants({ elevation: "floating" }),
  "z-50 min-w-56 max-w-80 overflow-y-auto p-1.5 text-sm [direction:ltr]",
  "max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))]",
);

const itemClass = cn(menuItemClass, "cursor-default select-none text-fg-secondary data-[highlighted]:bg-surface-hover data-[disabled]:opacity-40");

/** The right-hand side of an entry: a count, a summary of a submenu's state, or
 *  its arrow. */
function EntryEnd({ children }: { children: ReactNode }) {
  return <span className="ml-auto flex shrink-0 items-center gap-1 pl-3 text-xs font-normal text-fg-muted">{children}</span>;
}

/** The box at the left of an option: a tick when it is selected. */
function Tick() {
  return (
    <span className="flex w-4 shrink-0 justify-center text-link" aria-hidden>
      <Radix.ItemIndicator>
        <CheckIcon size={14} />
      </Radix.ItemIndicator>
    </span>
  );
}

function OptionLabel({ option }: { option: MenuOption }) {
  return (
    <>
      <span className="min-w-0 truncate">{option.label}</span>
      {option.count !== undefined && <EntryEnd>{option.count}</EntryEnd>}
    </>
  );
}

const optionText = (option: MenuOption) => (option.text ?? (typeof option.label === "string" ? option.label : option.value)).toLowerCase();

/** A search box above a long list of options. The menu reads typed letters as
 *  jumps to an entry, so the box keeps them to itself, except the keys that
 *  leave it: the down arrow moves into the list, and Escape closes the menu. */
function OptionSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const keepKeys = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "Escape") event.stopPropagation();
  };
  return (
    <input
      type="search"
      autoFocus
      value={query}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={keepKeys}
      placeholder="Search"
      aria-label="Search the options"
      className="mb-1 w-full rounded-control border border-line-input bg-surface px-2 py-1.5 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    />
  );
}

function ChoiceEntry({ entry }: { entry: Extract<MenuEntry, { type: "choice" }> }) {
  const [query, setQuery] = useState("");
  const searchable = entry.options.length > SEARCH_FROM_OPTIONS;
  const shown = searchable && query ? entry.options.filter((option) => optionText(option).includes(query.toLowerCase())) : entry.options;
  const search = searchable && <OptionSearch query={query} onChange={setQuery} />;
  if (entry.multiple) {
    const toggle = (value: string, on: boolean) => entry.onChange(on ? [...entry.selected, value] : entry.selected.filter((v) => v !== value));
    return (
      <>
        {search}
        {shown.map((option) => (
          <Radix.CheckboxItem
            key={option.value}
            title={option.hint}
            className={itemClass}
            checked={entry.selected.includes(option.value)}
            onCheckedChange={(on) => toggle(option.value, on === true)}
            // Ticking an option keeps the menu open for the next one.
            onSelect={(event) => event.preventDefault()}
          >
            <Tick />
            <OptionLabel option={option} />
          </Radix.CheckboxItem>
        ))}
      </>
    );
  }
  return (
    <>
      {search}
      <Radix.RadioGroup value={entry.selected[0] ?? ""} onValueChange={(value) => entry.onChange([value])}>
        {shown.map((option) => (
          <Radix.RadioItem key={option.value} value={option.value} title={option.hint} className={itemClass}>
            <Tick />
            <OptionLabel option={option} />
          </Radix.RadioItem>
        ))}
      </Radix.RadioGroup>
    </>
  );
}

/** A submenu. Besides opening when the pointer rests on it, a click opens it,
 *  and a second click closes it again. Radix would reopen it as soon as the
 *  pointer moves on the entry, so after a closing click it stays closed until
 *  the pointer has left the entry. */
function SubmenuEntry({ entry }: { entry: Extract<MenuEntry, { type: "submenu" }> }) {
  const [open, setOpen] = useState(false);
  const closedByClick = useRef(false);
  return (
    <Radix.Sub
      open={open}
      onOpenChange={(next) => {
        if (!(next && closedByClick.current)) setOpen(next);
      }}
    >
      <Radix.SubTrigger
        title={entry.hint}
        className={cn(itemClass, "data-[state=open]:bg-surface-hover")}
        onPointerLeave={() => (closedByClick.current = false)}
        onClick={(event) => {
          if (!open) return;
          event.preventDefault();
          closedByClick.current = true;
          setOpen(false);
        }}
      >
        <span className="min-w-0 truncate">{entry.label}</span>
        <EntryEnd>
          {entry.value !== undefined && <span className="max-w-32 truncate">{entry.value}</span>}
          <ChevronIcon size={16} className="rotate-180" aria-hidden />
        </EntryEnd>
      </Radix.SubTrigger>
      <Radix.Portal>
        <Radix.SubContent sideOffset={4} alignOffset={-6} collisionPadding={8} className={panelClass}>
          <MenuEntries entries={entry.entries} />
        </Radix.SubContent>
      </Radix.Portal>
    </Radix.Sub>
  );
}

function MenuEntries({ entries }: { entries: MenuEntry[] }) {
  return entries.map((entry) => {
    switch (entry.type) {
      case "action":
        return (
          <Radix.Item
            key={entry.key}
            title={entry.hint}
            onSelect={entry.onSelect}
            className={cn(itemClass, entry.danger && "text-negative data-[highlighted]:bg-negative-soft")}
          >
            {entry.icon && <span className={cn("shrink-0", entry.danger ? "text-negative" : "text-fg-subtle")} aria-hidden>{entry.icon}</span>}
            {entry.label}
          </Radix.Item>
        );
      case "submenu":
        return <SubmenuEntry key={entry.key} entry={entry} />;
      case "choice":
        return <ChoiceEntry key={entry.key} entry={entry} />;
      case "heading":
        return (
          <Radix.Label key={entry.key} className="px-2 pb-1 pt-2 text-xs font-semibold text-fg-muted">
            {entry.label}
          </Radix.Label>
        );
      case "separator":
        return <Radix.Separator key={entry.key} className="mx-1 my-1 h-px bg-line" />;
    }
  });
}

/** A menu that opens from `trigger`, an element that can take a ref, such as
 *  a Button. `open` and `onOpenChange` let the page open it itself. */
export function DropdownMenu({ trigger, entries, label, open, onOpenChange }: {
  trigger: ReactNode;
  entries: MenuEntry[];
  /** What a screen reader announces for the menu. */
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Radix.Root dir="rtl" modal={false} open={open} onOpenChange={onOpenChange}>
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content aria-label={label} align="end" sideOffset={6} collisionPadding={8} className={panelClass}>
          <MenuEntries entries={entries} />
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
