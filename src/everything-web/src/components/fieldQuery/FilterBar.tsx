import { fieldById, filterFromOption, filterOptions, filterText, selectedOptions, type FieldDef, type FieldFilter } from "@cn/core/fieldQuery";
import { DropdownMenu, type MenuEntry, type MenuOption } from "@cn/ui/DropdownMenu";
import { pillButtonClass, QueryChip } from "./QueryChip";

/** One value of a choice field as the data holds it, with how many rows it
 *  would show and, for values that come from the data, its display name. */
export interface Facet {
  value: string;
  label: string | null;
  count: number;
}

/** A choice field's options: its own list, or the values found in the data,
 *  with their counts once they have loaded. */
function choiceOptions(field: Extract<FieldDef, { kind: "choice" }>, facets: Facet[] | undefined): MenuOption[] {
  if (field.options) {
    return field.options.map((option) => ({
      ...option,
      count: facets && (facets.find((f) => f.value === option.value)?.count ?? 0),
    }));
  }
  return (facets ?? [])
    .map((facet) => ({ value: facet.value, label: facet.label ?? facet.value, count: facet.count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The display names of the values that come from the data, for the chips. */
const facetLabels = (facets: Facet[] | undefined) => Object.fromEntries((facets ?? []).map((f) => [f.value, f.label ?? f.value]));

/** The Filter button, and a pill for every active filter. The button's menu
 *  lists the fields, grouped where fields share a group, and each field opens
 *  its options. A pill opens its field's options again, and its cross removes
 *  the filter. */
export function FilterBar({ fields, filters, onChange, facets }: {
  fields: readonly FieldDef[];
  filters: FieldFilter[];
  onChange: (filters: FieldFilter[]) => void;
  /** The values of the choice fields, by field id. */
  facets?: Record<string, Facet[]>;
}) {
  const filterOf = (field: FieldDef) => filters.find((filter) => filter.field === field.id);
  const set = (field: FieldDef, values: string[]) => {
    const others = filters.filter((filter) => filter.field !== field.id);
    onChange(values.length === 0 ? others : [...others, filterFromOption(field, values)]);
  };
  const remove = (field: FieldDef) => set(field, []);
  const optionsEntry = (field: FieldDef): MenuEntry => ({
    type: "choice",
    key: field.id,
    multiple: field.kind === "choice" && field.multiple,
    options: field.kind === "choice" ? choiceOptions(field, facets?.[field.id]) : filterOptions(field),
    selected: selectedOptions(filterOf(field)),
    onChange: (values) => set(field, values),
  });
  const fieldEntry = (field: FieldDef): MenuEntry => {
    const filter = filterOf(field);
    return {
      type: "submenu",
      key: field.id,
      label: field.label,
      hint: field.hint,
      value: filter && filterText(field, filter, facetLabels(facets?.[field.id])),
      entries: [optionsEntry(field)],
    };
  };
  // A group takes the place of its first field in the menu.
  const entries = fields.flatMap((field): MenuEntry[] => {
    if (!field.group) return [fieldEntry(field)];
    const group = fields.filter((f) => f.group === field.group);
    if (group[0] !== field) return [];
    const active = group.filter((f) => filterOf(f)).length;
    return [{ type: "submenu", key: `group:${field.group}`, label: field.group, value: active > 0 ? `${active} on` : undefined, entries: group.map(fieldEntry) }];
  });
  if (filters.length > 0) entries.push({ type: "separator", key: "separator" }, { type: "action", key: "clear", label: "Remove every filter", onSelect: () => onChange([]) });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu
        label="Filter"
        entries={entries}
        trigger={
          <button type="button" className={pillButtonClass}>
            Filter
          </button>
        }
      />
      {filters.map((filter) => {
        const field = fieldById(fields, filter.field);
        if (!field) return null;
        return (
          <QueryChip
            key={field.id}
            label={
              <>
                <span className="text-fg-muted">{field.label}:</span> {filterText(field, filter, facetLabels(facets?.[field.id]))}
              </>
            }
            menu={[optionsEntry(field)]}
            menuLabel={field.label}
            removeLabel={`Remove the filter on ${field.label.toLowerCase()}`}
            onRemove={() => remove(field)}
          />
        );
      })}
    </div>
  );
}
