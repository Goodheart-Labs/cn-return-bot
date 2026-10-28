import * as Radix from "@radix-ui/react-dropdown-menu";
import { createContext, useContext, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { cardVariants } from "./Card";
import { cn } from "./cn";
import { CheckIcon, ChevronIcon, PreviousIcon } from "./icons";
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
 * right.
 *
 * A phone has no room for panels side by side, so there a submenu takes the
 * menu's place instead, with a Back row at its top. */

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

type SubmenuEntry = { type: "submenu"; key: string; label: ReactNode; hint?: string; value?: ReactNode; entries: MenuEntry[] };

/** One entry of a menu. An action runs and closes the menu. A submenu opens
 *  another menu of entries, and `value` sums up its current state at the
 *  right. A choice is a list of options: a single choice closes the menu on a
 *  pick, a multiple choice stays open so more options can be ticked. */
export type MenuEntry =
  | { type: "action"; key: string; label: ReactNode; icon?: ReactNode; hint?: string; danger?: boolean; onSelect: () => void }
  | SubmenuEntry
  | { type: "choice"; key: string; multiple: boolean; options: MenuOption[]; selected: readonly string[]; onChange: (selected: string[]) => void }
  | { type: "heading"; key: string; label: ReactNode }
  | { type: "separator"; key: string };

/** A choice with more options than this gets a search box above them. */
const SEARCH_FROM_OPTIONS = 12;

/** Screens narrower than this open submenus in place of the menu. */
const PHONE_QUERY = "(max-width: 639px)";

/** The floating panel of a menu or submenu. Every panel has the same width,
 *  so a summary that appears on an entry never widens its panel, and three
 *  levels fit beside each other. It never grows past the space the screen has
 *  left, and scrolls when its entries need more. */
const panelClass = cn(
  cardVariants({ elevation: "floating" }),
  "z-50 w-64 overflow-y-auto p-1.5 text-sm [direction:ltr]",
  "max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))]",
);

/** A menu row. Radix moves focus to the row under the pointer, so a row shows
 *  its highlight and no focus ring, whether the pointer or the keyboard got
 *  there. */
const itemClass = cn(menuItemClass, "cursor-default select-none text-fg-secondary focus-visible:ring-0 data-[highlighted]:bg-surface-hover data-[disabled]:opacity-40");

/** On a phone, the keys of the submenus opened so far, and how to open or
 *  leave one. Elsewhere it is null and submenus open beside their menu. */
const DrillDown = createContext<{ open: (key: string) => void } | null>(null);

const watchPhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const useIsPhone = () => useSyncExternalStore(watchPhone, () => window.matchMedia(PHONE_QUERY).matches);

/** The right-hand side of an entry: a count, a summary of a submenu's state, or
 *  its arrow. */
function EntryEnd({ children }: { children: ReactNode }) {
  return <span className="ml-auto flex shrink-0 items-center gap-1 pl-3 text-xs font-normal text-fg-muted">{children}</span>;
}

/** What sits left of an option. In a multiple choice it is a checkbox, empty
 *  until the option is ticked, so the list shows that several can be picked.
 *  In a single choice only the picked option has a tick. */
function Tick({ checkbox }: { checkbox: boolean }) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center",
        checkbox ? "rounded-[4px] border border-line-strong text-on-primary group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary" : "text-link",
      )}
      aria-hidden
    >
      <Radix.ItemIndicator>
        <CheckIcon size={checkbox ? 12 : 14} />
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

/** A search box above a long list of options. Beside its menu it stays at the
 *  top while the list scrolls. On a phone the Back row stays there instead.
 *  The menu reads typed letters as jumps to an entry, so the box keeps them to
 *  itself, except the keys that leave it: the down arrow moves into the list,
 *  and Escape closes the menu. */
function OptionSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const onPhone = useContext(DrillDown) !== null;
  const keepKeys = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "Escape") event.stopPropagation();
  };
  return (
    <div className={cn("mb-1", !onPhone && "sticky -top-1.5 z-10 -mx-1.5 -mt-1.5 bg-surface p-1.5")}>
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={keepKeys}
        placeholder="Search"
        aria-label="Search the options"
        className="w-full rounded-control border border-line-input bg-surface px-2 py-1.5 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
    </div>
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
            className={cn(itemClass, "group")}
            checked={entry.selected.includes(option.value)}
            onCheckedChange={(on) => toggle(option.value, on === true)}
            // Ticking an option keeps the menu open for the next one.
            onSelect={(event) => event.preventDefault()}
          >
            <Tick checkbox />
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
            <Tick checkbox={false} />
            <OptionLabel option={option} />
          </Radix.RadioItem>
        ))}
      </Radix.RadioGroup>
    </>
  );
}

/** A submenu's entry: its name, then a summary of its state and its arrow at
 *  the right. The name keeps its room first, and the summary is cut short to
 *  what is left. */
function SubmenuLabel({ entry, arrow }: { entry: SubmenuEntry; arrow: ReactNode }) {
  return (
    <>
      <span className="max-w-[75%] shrink-0 truncate">{entry.label}</span>
      <span className="ml-auto flex min-w-0 items-center gap-1 pl-3 text-xs font-normal text-fg-muted">
        {entry.value !== undefined && <span className="min-w-0 truncate">{entry.value}</span>}
        <span className="shrink-0">{arrow}</span>
      </span>
    </>
  );
}

/** A submenu that opens beside its menu. It opens when the pointer rests on
 *  it or on a click. A second click closes it, but only when a click opened
 *  it: a click on a submenu the pointer already opened keeps it open. Radix
 *  would reopen a closed submenu as soon as the pointer moves on its entry, so
 *  after a closing click it stays closed until the pointer has left. */
function SideSubmenu({ entry }: { entry: SubmenuEntry }) {
  const [open, setOpen] = useState(false);
  const closedByClick = useRef(false);
  const openedByClick = useRef(false);
  const clicking = useRef(false);
  return (
    <Radix.Sub
      open={open}
      onOpenChange={(next) => {
        if (next && closedByClick.current) return;
        if (next) openedByClick.current = clicking.current;
        setOpen(next);
      }}
    >
      <Radix.SubTrigger
        title={entry.hint}
        className={cn(itemClass, "data-[state=open]:bg-surface-hover")}
        onPointerLeave={() => (closedByClick.current = false)}
        onClick={(event) => {
          if (!open) {
            // Radix opens the submenu right after this handler.
            clicking.current = true;
            queueMicrotask(() => (clicking.current = false));
            return;
          }
          event.preventDefault();
          if (!openedByClick.current) {
            openedByClick.current = true;
            return;
          }
          closedByClick.current = true;
          setOpen(false);
        }}
      >
        <SubmenuLabel entry={entry} arrow={<ChevronIcon size={16} className="rotate-180" aria-hidden />} />
      </Radix.SubTrigger>
      <Radix.Portal>
        <Radix.SubContent sideOffset={4} alignOffset={-6} collisionPadding={8} className={panelClass}>
          <MenuEntries entries={entry.entries} />
        </Radix.SubContent>
      </Radix.Portal>
    </Radix.Sub>
  );
}

/** On a phone, a submenu is a row that shows its entries in place of the
 *  menu's. */
function DrillSubmenu({ entry, open }: { entry: SubmenuEntry; open: (key: string) => void }) {
  return (
    <Radix.Item
      title={entry.hint}
      className={itemClass}
      onSelect={(event) => {
        event.preventDefault();
        open(entry.key);
      }}
    >
      <SubmenuLabel entry={entry} arrow={<ChevronIcon size={16} aria-hidden />} />
    </Radix.Item>
  );
}

function MenuEntries({ entries }: { entries: MenuEntry[] }) {
  const drillDown = useContext(DrillDown);
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
        return drillDown ? <DrillSubmenu key={entry.key} entry={entry} open={drillDown.open} /> : <SideSubmenu key={entry.key} entry={entry} />;
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

/** The submenus along a path of keys, from the menu's own entries down. A key
 *  that no longer names a submenu ends the path. */
function submenusAlong(entries: MenuEntry[], path: string[]): SubmenuEntry[] {
  const found: SubmenuEntry[] = [];
  let level = entries;
  for (const key of path) {
    const submenu = level.find((entry): entry is SubmenuEntry => entry.type === "submenu" && entry.key === key);
    if (!submenu) break;
    found.push(submenu);
    level = submenu.entries;
  }
  return found;
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
  const isPhone = useIsPhone();
  // The path of submenus opened on a phone. It holds keys, not entries, so the
  // shown submenu always has the current selection.
  const [path, setPath] = useState<string[]>([]);
  const opened = submenusAlong(entries, path);
  const shown = isPhone ? opened.at(-1) : undefined;
  return (
    <Radix.Root
      dir="rtl"
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (!next) setPath([]);
        onOpenChange?.(next);
      }}
    >
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content aria-label={label} align="start" sideOffset={6} collisionPadding={8} className={panelClass}>
          <DrillDown.Provider value={isPhone ? { open: (key) => setPath([...opened.map((s) => s.key), key]) } : null}>
            {shown && (
              <div className="sticky -top-1.5 z-10 -mx-1.5 -mt-1.5 bg-surface px-1.5 pt-1.5">
                <Radix.Item
                  className={cn(itemClass, "font-semibold text-fg")}
                  onSelect={(event) => {
                    event.preventDefault();
                    setPath(opened.slice(0, -1).map((s) => s.key));
                  }}
                >
                  <PreviousIcon size={16} aria-hidden />
                  {shown.label}
                </Radix.Item>
                <Radix.Separator className="mx-1 my-1 h-px bg-line" />
              </div>
            )}
            <MenuEntries entries={shown ? shown.entries : entries} />
          </DrillDown.Provider>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
