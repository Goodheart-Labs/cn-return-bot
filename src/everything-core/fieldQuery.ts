/* Filtering and sorting a list by its fields. A page lists its fields once, in
 * a field registry: an array of FieldDefs. Everything else is derived from
 * that list: the options of the Filter and Sort menus, the chips that show
 * the active filters, the text of the page address, and the request the
 * database runs. Adding a field to a page is one more entry in its registry,
 * plus the column it names in the data.
 *
 * A field is one of four kinds:
 *   count    a whole number, filtered by "at least" (or "at most") one of a
 *            few thresholds that grow like the Fibonacci numbers
 *   percent  a chance between 0 and 1, filtered by "at least" a tenth
 *   date     a moment, filtered by how many days back it lies
 *   choice   one of a list of values, filtered by the values to keep
 *
 * A list can be sorted by any number of fields, one after another. Every
 * sort level that has a deeper level after it sorts by buckets of its field
 * instead of its exact value: the same thresholds and day spans the filters
 * use. So "newest first, then most viewed" lists today's notes by views, then
 * yesterday's by views, and so on. Each card then names the bucket it sits in,
 * because otherwise the order would look random. Every function here is pure. */

export interface FieldOption {
  value: string;
  label: string;
  /** Shown when the pointer rests on the option. */
  hint?: string;
}

type FieldBase = {
  /** The column of the data, and the field's name in the page address. */
  id: string;
  label: string;
  /** Shown when the pointer rests on the field. */
  hint?: string;
  /** Fields with the same group sit together in one submenu, such as Creator. */
  group?: string;
  /** Whether the Sort menu offers the field. */
  sortable: boolean;
};

export type CountField = FieldBase & {
  kind: "count";
  /** Ascending. A filter keeps rows with at least (or at most) one of these. */
  thresholds: readonly number[];
  /** "atMost" suits a field where less is better, such as a note's length. */
  bound: "atLeast" | "atMost";
  /** Whether an "at least" filter also offers "None", which keeps the rows
   *  whose count is zero. */
  offerNone?: boolean;
};
export type PercentField = FieldBase & { kind: "percent" };
export type DateField = FieldBase & { kind: "date" };
export type ChoiceField = FieldBase & {
  kind: "choice";
  multiple: boolean;
  /** The values, best first. Without them the values come from the data, and
   *  `labelColumn` names the column that holds each value's display name. */
  options?: readonly FieldOption[];
  labelColumn?: string;
};
export type FieldDef = CountField | PercentField | DateField | ChoiceField;

/** Thresholds for counts of votes and other small numbers. */
export const SMALL_COUNTS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
/** Thresholds for counts of readers, which reach the hundreds. */
export const LARGE_COUNTS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377] as const;
/** The tenths a percent filter offers, and the buckets of a percent sort. */
export const PERCENT_THRESHOLDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;

/** The day spans of a date filter, newest first. Each starts at midnight in the
 *  reader's time zone, `daysBack` days ago, so "Last 3 days" is today and the
 *  two days before. */
export const DATE_SPANS = [
  { id: "today", label: "Today", daysBack: 0 },
  { id: "yesterday", label: "Since yesterday", daysBack: 1 },
  { id: "3d", label: "Last 3 days", daysBack: 2 },
  { id: "7d", label: "Last 7 days", daysBack: 6 },
  { id: "14d", label: "Last 14 days", daysBack: 13 },
  { id: "30d", label: "Last 30 days", daysBack: 29 },
  { id: "60d", label: "Last 60 days", daysBack: 59 },
] as const;
export type DateSpanId = (typeof DATE_SPANS)[number]["id"];

/** One active filter. A count or percent field keeps the rows past a
 *  threshold, where a count threshold of 0 means "none at all". A date field
 *  keeps a day span. A choice field keeps the listed values. */
export type FieldFilter = { field: string; threshold: number } | { field: string; span: DateSpanId } | { field: string; values: string[] };

export interface FieldSort {
  field: string;
  descending: boolean;
}

/** Everything a page's list is narrowed, ordered and shown by. `display`
 *  names the page's display options that are switched on. */
export interface FieldQuery {
  filters: FieldFilter[];
  sorts: FieldSort[];
  display: string[];
}

/** The query as the database function takes it. Dates are seconds since 1970.
 *  A sort with `buckets` sorts by how many of those ascending boundaries the
 *  value reaches. A sort with `order` sorts a choice by its position in that
 *  list, worst first. */
export interface QueryRequest {
  filters: ({ column: string; min?: number; max?: number } | { column: string; in: string[] })[];
  sorts: { column: string; descending: boolean; buckets?: number[]; order?: string[] }[];
}

export const fieldById = (fields: readonly FieldDef[], id: string) => fields.find((field) => field.id === id);

/** Midnight at the start of the day `daysBack` days before `now`, in the
 *  reader's time zone. */
export const startOfDay = (now: Date, daysBack: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);

const seconds = (date: Date) => date.getTime() / 1000;
const percentText = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** The thresholds a field is filtered and bucketed by. A date's are the start
 *  of each span, oldest first, in seconds. */
function boundaries(field: CountField | PercentField | DateField, now: Date): number[] {
  if (field.kind === "count") return [...field.thresholds];
  if (field.kind === "percent") return [...PERCENT_THRESHOLDS];
  return DATE_SPANS.map((span) => seconds(startOfDay(now, span.daysBack))).reverse();
}

// ---------------------------------------------------------------------------
// Filters

/** A filter's options in the menu, as values that `filterFromOption` reads. */
export function filterOptions(field: Exclude<FieldDef, ChoiceField>): FieldOption[] {
  if (field.kind === "date") return DATE_SPANS.map((span) => ({ value: span.id, label: span.label }));
  if (field.kind === "percent") return PERCENT_THRESHOLDS.map((t) => ({ value: String(t), label: `${percentText(t)} or more` }));
  const options = field.thresholds.map((t) => ({ value: String(t), label: field.bound === "atLeast" ? `${t} or more` : `At most ${t}` }));
  return field.bound === "atLeast" && field.offerNone ? [{ value: "0", label: "None" }, ...options] : options;
}

/** The filter a picked option stands for. */
export function filterFromOption(field: FieldDef, values: string[]): FieldFilter {
  if (field.kind === "choice") return { field: field.id, values };
  if (field.kind === "date") return { field: field.id, span: values[0] as DateSpanId };
  return { field: field.id, threshold: Number(values[0]) };
}

/** The option values a filter has picked, the reverse of `filterFromOption`. */
export function selectedOptions(filter: FieldFilter | undefined): string[] {
  if (!filter) return [];
  if ("values" in filter) return filter.values;
  if ("span" in filter) return [filter.span];
  return [String(filter.threshold)];
}

/** What a filter keeps, in the words of its chip, for example "3 or more". */
export function filterText(field: FieldDef, filter: FieldFilter, labels: Record<string, string> = {}): string {
  if ("values" in filter) {
    const names = filter.values.map((value) => field.kind === "choice" && field.options?.find((o) => o.value === value)?.label || labels[value] || value);
    const MAX_NAMED_VALUES = 2;
    return names.length > MAX_NAMED_VALUES ? `${names.length} selected` : names.join(", ");
  }
  if ("span" in filter) return DATE_SPANS.find((span) => span.id === filter.span)!.label;
  if (field.kind === "percent") return `${percentText(filter.threshold)} or more`;
  if (filter.threshold === 0) return "None";
  return field.kind === "count" && field.bound === "atMost" ? `At most ${filter.threshold}` : `${filter.threshold} or more`;
}

function filterRequest(field: FieldDef, filter: FieldFilter, now: Date): QueryRequest["filters"][number] {
  if ("values" in filter) return { column: field.id, in: filter.values };
  if ("span" in filter) return { column: field.id, min: seconds(startOfDay(now, DATE_SPANS.find((span) => span.id === filter.span)!.daysBack)) };
  if (filter.threshold === 0) return { column: field.id, max: 0 };
  return field.kind === "count" && field.bound === "atMost" ? { column: field.id, max: filter.threshold } : { column: field.id, min: filter.threshold };
}

// ---------------------------------------------------------------------------
// Sorting

/** A sort level is bucketed when a deeper level follows it. */
export const isBucketed = (sorts: readonly FieldSort[], index: number) => index < sorts.length - 1;

function sortRequest(field: FieldDef, sort: FieldSort, bucketed: boolean, now: Date): QueryRequest["sorts"][number] {
  const base = { column: field.id, descending: sort.descending };
  if (field.kind === "choice") return { ...base, order: (field.options ?? []).map((o) => o.value).reverse() };
  return bucketed ? { ...base, buckets: boundaries(field, now) } : base;
}

/** The words of a sort's direction, as the Sort menu shows them. */
export function directionText(field: FieldDef, descending: boolean): string {
  if (field.kind === "date") return descending ? "Newest first" : "Oldest first";
  if (field.kind === "choice") return descending ? "Best first" : "Worst first";
  return descending ? "Highest first" : "Lowest first";
}

/** "a to b" for a range of whole numbers, or the one number when they are
 *  equal. */
const rangeText = (low: number, high: number) => (low === high ? String(low) : `${low} to ${high}`);

/** The bucket a value falls in, in words, for the chip on a card. Null when
 *  the value is missing. */
export function bucketText(field: FieldDef, value: unknown, now: Date, labels: Record<string, string> = {}): string | null {
  if (value === null || value === undefined) return null;
  if (field.kind === "choice") return field.options?.find((o) => o.value === String(value))?.label ?? labels[String(value)] ?? String(value);
  if (field.kind === "date") {
    const span = DATE_SPANS.findIndex((s) => new Date(String(value)) >= startOfDay(now, s.daysBack));
    if (span === 0) return "today";
    if (span === 1) return "yesterday";
    if (span === -1) return `${DATE_SPANS.at(-1)!.daysBack + 1} or more days ago`;
    return `${rangeText(DATE_SPANS[span - 1]!.daysBack + 1, DATE_SPANS[span]!.daysBack)} days ago`;
  }
  const number = Number(value);
  const limits = boundaries(field, now);
  const index = limits.filter((limit) => limit <= number).length;
  if (field.kind === "percent") {
    const low = index === 0 ? 0 : limits[index - 1]!;
    return index === limits.length ? `${percentText(low)} or more` : `${percentText(low)} to ${percentText(limits[index]!)}`;
  }
  if (index === 0) return limits[0] === 1 ? "none" : `under ${limits[0]}`;
  if (index === limits.length) return `${limits.at(-1)} or more`;
  return rangeText(limits[index - 1]!, limits[index]! - 1);
}

/** The chips a card shows: one per bucketed sort level, naming the bucket the
 *  card's row falls in. */
export function bucketChips(fields: readonly FieldDef[], sorts: readonly FieldSort[], row: Record<string, unknown>, now: Date, labels: Record<string, string> = {}): string[] {
  return sorts.flatMap((sort, index) => {
    const field = fieldById(fields, sort.field);
    const text = field && isBucketed(sorts, index) ? bucketText(field, row[field.id], now, labels) : null;
    return text ? [`${field!.label}: ${text}`] : [];
  });
}

/** The request the database runs for a query. */
export function buildRequest(fields: readonly FieldDef[], query: Pick<FieldQuery, "filters" | "sorts">, now: Date): QueryRequest {
  const known = <T extends { field: string }>(items: readonly T[]) => items.flatMap((item) => (fieldById(fields, item.field) ? [[fieldById(fields, item.field)!, item] as const] : []));
  return {
    filters: known(query.filters).map(([field, filter]) => filterRequest(field, filter, now)),
    sorts: known(query.sorts).map(([field, sort], index) => sortRequest(field, sort, isBucketed(query.sorts, index), now)),
  };
}

// ---------------------------------------------------------------------------
// The page address

/** The address's query parameters that carry a FieldQuery. A link that has
 *  any of them shows exactly that query. */
export const QUERY_PARAMS = { filters: "filter", sorts: "sort", display: "show" } as const;

const LIST_SEPARATOR = ",";

/** Writes a query into address parameters, for example
 *  filter=helpful_votes:3&filter=on_x:not_posted&sort=-rating&show=chat. A
 *  part that is empty is left out, because reading a missing part gives an
 *  empty one. A query that is empty everywhere still writes an empty filter,
 *  so the address says that it carries a query. */
export function writeQuery(query: FieldQuery, params: URLSearchParams): void {
  for (const name of Object.values(QUERY_PARAMS)) params.delete(name);
  for (const filter of query.filters) params.append(QUERY_PARAMS.filters, `${filter.field}:${selectedOptions(filter).join(LIST_SEPARATOR)}`);
  for (const sort of query.sorts) params.append(QUERY_PARAMS.sorts, `${sort.descending ? "-" : ""}${sort.field}`);
  if (query.display.length > 0) params.set(QUERY_PARAMS.display, query.display.join(LIST_SEPARATOR));
  if (![...params.keys()].some((name) => (Object.values(QUERY_PARAMS) as string[]).includes(name))) params.set(QUERY_PARAMS.filters, "");
}

/** Whether a choice value is one the field knows. Values that come from the
 *  data are not known in advance, so any of them is accepted. */
const knownValue = (field: ChoiceField, value: string) => !field.options || field.options.some((option) => option.value === value);

/** Reads one filter, or null when it names an unknown field or a value the
 *  field does not offer. */
function readFilter(fields: readonly FieldDef[], text: string): FieldFilter | null {
  const colon = text.indexOf(":");
  const field = fieldById(fields, text.slice(0, colon));
  const values = text.slice(colon + 1).split(LIST_SEPARATOR).filter(Boolean);
  if (!field || colon < 0 || values.length === 0) return null;
  if (field.kind === "choice") {
    const kept = values.filter((value) => knownValue(field, value));
    return kept.length > 0 ? { field: field.id, values: field.multiple ? kept : kept.slice(0, 1) } : null;
  }
  if (!filterOptions(field).some((option) => option.value === values[0])) return null;
  return filterFromOption(field, values);
}

/** Reads a query from the address, or null when the address carries none.
 *  Whatever names an unknown field, an unknown display option or a value a
 *  field does not offer is left out, so an old link still opens. */
export function readQuery(fields: readonly FieldDef[], displayOptions: readonly string[], params: URLSearchParams): FieldQuery | null {
  if (!Object.values(QUERY_PARAMS).some((name) => params.has(name))) return null;
  const filters = params.getAll(QUERY_PARAMS.filters).flatMap((text) => readFilter(fields, text) ?? []);
  const sorts = params.getAll(QUERY_PARAMS.sorts).flatMap((text) => {
    const descending = text.startsWith("-");
    const field = fieldById(fields, descending ? text.slice(1) : text);
    return field?.sortable ? [{ field: field.id, descending }] : [];
  });
  const display = (params.get(QUERY_PARAMS.display) ?? "").split(LIST_SEPARATOR).filter((id) => displayOptions.includes(id));
  return {
    filters: filters.filter((filter, index) => filters.findIndex((f) => f.field === filter.field) === index),
    sorts: sorts.filter((sort, index) => sorts.findIndex((s) => s.field === sort.field) === index),
    display,
  };
}
