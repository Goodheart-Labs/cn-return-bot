import { fieldById, filterFromOption, filterOptions, filterText, selectedOptions, type FieldDef, type FieldFilter } from "@cn/core/fieldQuery";
import { DropdownMenu, type MenuEntry, type MenuOption } from "@cn/ui/DropdownMenu";
import { pillButtonClass, QueryChip } from "@cn/ui/QueryChip";
import { useState } from "react";

/** One value of a choice field as the data holds it, with how many rows it
 *  would show and, for values that come from the data, its display name. */
export interface Facet {
  value: string;
  label: string | null;
  count: number;
}

interface FilterProps {
  fields: readonly FieldDef[];
  filters: FieldFilter[];
  onChange: (filters: FieldFilter[]) => void;
  /** The values of the choice fields, by field id. */
  facets?: Record<string, Facet[]>;
  /** Whether a filter can be switched to exclude what it picks. On by
   *  default, because the database function behind most lists,
   *  field_query_condition, reads a filter's `not`. A list whose database
   *  function does not must switch it off. */
  canExclude?: boolean;
}

/** The fields whose Exclude box is ticked while nothing is picked yet. Their
 *  first pick makes an excluding filter. */
interface PendingExclusions {
  fields: ReadonlySet<string>;
  set: (field: string, excluded: boolean) => void;
}

const EXCLUDE = "exclude";

/** A choice field's options: its own list, or the values found in the data,
 *  the most rows first, with their counts once they have loaded. */
function choiceOptions(field: Extract<FieldDef, { kind: "choice" }>, facets: Facet[] | undefined): MenuOption[] {
  if (field.options) {
    return field.options.map((option) => ({
      ...option,
      count: facets && (facets.find((f) => f.value === option.value)?.count ?? 0),
    }));
  }
  return (facets ?? [])
    .map((facet) => ({ value: facet.value, label: facet.label ?? facet.value, count: facet.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** The display names of the values that come from the data, for the pills. */
const facetLabels = (facets: Facet[] | undefined) => Object.fromEntries((facets ?? []).map((f) => [f.value, f.label ?? f.value]));

/** What the Filter button and the pills share: a field's options as a menu
 *  entry, the menu of every field, and the words of an active filter. */
function filterMenu({ fields, filters, onChange, facets, canExclude = true }: FilterProps, pending?: PendingExclusions) {
  const filterOf = (field: FieldDef) => filters.find((filter) => filter.field === field.id);
  const isExcluded = (field: FieldDef) => filterOf(field)?.negated ?? pending?.fields.has(field.id) ?? false;
  const replace = (field: FieldDef, filter: FieldFilter | null) => {
    const others = filters.filter((f) => f.field !== field.id);
    onChange(filter ? [...others, filter] : others);
  };
  // Unticking the last option keeps the Exclude box ticked for the next pick.
  const set = (field: FieldDef, values: string[]) => {
    const excluded = isExcluded(field);
    pending?.set(field.id, excluded && values.length === 0);
    replace(field, values.length === 0 ? null : filterFromOption(field, values, excluded));
  };
  const setExcluded = (field: FieldDef, excluded: boolean) => {
    const filter = filterOf(field);
    if (filter) replace(field, filterFromOption(field, selectedOptions(filter), excluded));
    else pending?.set(field.id, excluded);
  };
  const text = (field: FieldDef, filter: FieldFilter) => filterText(field, filter, facetLabels(facets?.[field.id]));
  const optionsEntry = (field: FieldDef): MenuEntry => ({
    type: "choice",
    key: field.id,
    multiple: field.kind === "choice" && field.multiple,
    options: field.kind === "choice" ? choiceOptions(field, facets?.[field.id]) : filterOptions(field),
    selected: selectedOptions(filterOf(field)),
    onChange: (values) => set(field, values),
    // Values that come from the data, such as creators, are many and unknown
    // in advance, so they can be searched.
    searchable: field.kind === "choice" && !field.options,
  });
  // The Exclude box sits above the options, so a field's menu is the same
  // whether or not anything is picked yet.
  const fieldMenu = (field: FieldDef): MenuEntry[] =>
    canExclude
      ? [
          {
            type: "choice",
            key: `${field.id}:${EXCLUDE}`,
            multiple: true,
            options: [{ value: EXCLUDE, label: "Exclude" }],
            selected: isExcluded(field) ? [EXCLUDE] : [],
            onChange: (values) => setExcluded(field, values.includes(EXCLUDE)),
          },
          { type: "separator", key: `${field.id}:separator` },
          optionsEntry(field),
        ]
      : [optionsEntry(field)];
  const fieldEntry = (field: FieldDef): MenuEntry => {
    const filter = filterOf(field);
    return { type: "submenu", key: field.id, label: field.label, hint: field.hint, value: filter && text(field, filter), entries: fieldMenu(field) };
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
  return { entries, fieldMenu, text, remove: (field: FieldDef) => replace(field, null) };
}

/** The Filter button. Its menu lists the fields, grouped where fields share a
 *  group, and each field opens its options. */
export function FilterButton(props: FilterProps) {
  const [pendingFields, setPendingFields] = useState<ReadonlySet<string>>(new Set());
  const pending: PendingExclusions = {
    fields: pendingFields,
    set: (field, excluded) => setPendingFields((fields) => new Set([...fields].filter((f) => f !== field).concat(excluded ? [field] : []))),
  };
  return (
    <DropdownMenu
      label="Filter"
      entries={filterMenu(props, pending).entries}
      trigger={
        <button type="button" className={pillButtonClass}>
          {props.filters.length > 0 ? `Filter (${props.filters.length})` : "Filter"}
        </button>
      }
    />
  );
}

/** A pill for every active filter. A pill opens its field's options again,
 *  and its cross removes the filter. */
export function FilterPills(props: FilterProps) {
  const menu = filterMenu(props);
  if (props.filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {props.filters.map((filter) => {
        const field = fieldById(props.fields, filter.field);
        if (!field) return null;
        return (
          <QueryChip
            key={field.id}
            label={
              <>
                <span className="text-fg-muted">{field.label}:</span> {menu.text(field, filter)}
              </>
            }
            menu={menu.fieldMenu(field)}
            menuLabel={field.label}
            removeLabel={`Remove the filter on ${field.label.toLowerCase()}`}
            onRemove={() => menu.remove(field)}
          />
        );
      })}
    </div>
  );
}
