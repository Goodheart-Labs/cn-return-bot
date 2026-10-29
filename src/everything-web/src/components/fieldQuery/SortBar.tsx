import { directionText, fieldById, type FieldDef, type FieldSort } from "@cn/core/fieldQuery";
import { cn } from "@cn/ui/cn";
import { DropdownMenu, type MenuEntry } from "@cn/ui/DropdownMenu";
import { ArrowDownIcon, ArrowUpIcon } from "@cn/ui/icons";
import { pillButtonClass, QueryChip } from "./QueryChip";

/** The sort levels as numbered pills, then a button that adds one more. A
 *  pill's menu swaps its field, its arrow flips its direction, and its cross
 *  removes it. A new level starts with the direction that puts the most
 *  useful rows first: the highest, the newest or the best. */
export function SortBar({ fields, sorts, onChange }: {
  fields: readonly FieldDef[];
  sorts: FieldSort[];
  onChange: (sorts: FieldSort[]) => void;
}) {
  const sortable = fields.filter((field) => field.sortable);
  /** The fields a level can take: its own and those no other level uses. */
  const fieldChoice = (index: number | null, onPick: (field: string) => void): MenuEntry => ({
    type: "choice",
    key: "fields",
    multiple: false,
    options: sortable
      .filter((field) => !sorts.some((sort, i) => i !== index && sort.field === field.id))
      .map((field) => ({ value: field.id, label: field.label, hint: field.hint })),
    selected: index === null ? [] : [sorts[index]!.field],
    onChange: ([field]) => onPick(field!),
  });
  const replace = (index: number, sort: FieldSort | null) => onChange(sorts.flatMap((s, i) => (i !== index ? [s] : sort ? [sort] : [])));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-fg-muted">Sort</span>
      {sorts.map((sort, index) => {
        const field = fieldById(fields, sort.field);
        if (!field) return null;
        const direction = directionText(field, sort.descending);
        const flipped = directionText(field, !sort.descending);
        return (
          <QueryChip
            key={field.id}
            label={
              <>
                <span className="text-fg-muted">{index + 1}.</span> {field.label}
              </>
            }
            menu={[fieldChoice(index, (picked) => replace(index, { field: picked, descending: true }))]}
            menuLabel={`Sort level ${index + 1}`}
            removeLabel={`Stop sorting by ${field.label.toLowerCase()}`}
            onRemove={() => replace(index, null)}
            extra={
              <button
                type="button"
                onClick={() => replace(index, { ...sort, descending: !sort.descending })}
                aria-label={`${direction}. Switch to ${flipped.toLowerCase()}`}
                title={`${direction}. Click for ${flipped.toLowerCase()}`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {sort.descending ? <ArrowDownIcon size={14} aria-hidden /> : <ArrowUpIcon size={14} aria-hidden />}
              </button>
            }
          />
        );
      })}
      {sortable.length > sorts.length && (
        <DropdownMenu
          label="Add a sort level"
          entries={[fieldChoice(null, (picked) => onChange([...sorts, { field: picked, descending: true }]))]}
          trigger={
            <button type="button" className={cn(pillButtonClass, "border-dashed text-fg-secondary")}>
              {sorts.length === 0 ? "Sort by" : "Then by"}
            </button>
          }
        />
      )}
    </div>
  );
}
