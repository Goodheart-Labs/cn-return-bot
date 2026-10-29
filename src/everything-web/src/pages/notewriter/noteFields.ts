import { LARGE_COUNTS, type FieldDef, type FieldQuery } from "@cn/core/fieldQuery";
import type { AbTest, NotewriterSource } from "@cn/core/notewriter";

/* What the X notewriter page and the dashboard's notes filter and sort by.
 * Each field's id is a column of the database's notewriter_field_row
 * (migration 159). An A/B test is the field "picks.<test>", which reads that
 * key of the A/B picks of the run that wrote the note. */

/** Thresholds for a note's views, which run into the millions. */
const VIEW_COUNTS = [100, 1_000, 10_000, 100_000, 1_000_000];

const STATUS: FieldDef = {
  id: "status",
  label: "Status",
  kind: "choice",
  multiple: true,
  sortable: true,
  options: [
    { value: "helpful", label: "Rated helpful" },
    { value: "needs_ratings", label: "Needs more ratings" },
    { value: "not_helpful", label: "Rated not helpful" },
  ],
};

const WRITTEN: FieldDef = { id: "written", label: "Written", kind: "date", sortable: true };

/** The fields of each source's notes, without the A/B tests. */
export const NOTE_FIELDS: Record<NotewriterSource, FieldDef[]> = {
  x: [
    STATUS,
    WRITTEN,
    { id: "views", label: "Views", hint: "How often X showed the note, as the notewriter page last counted", kind: "count", thresholds: VIEW_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
    { id: "ratings", label: "Ratings", hint: "Every rating in X's public data, which lags about 3 days", kind: "count", thresholds: LARGE_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
  ],
  commonnotes: [
    STATUS,
    WRITTEN,
    {
      id: "writer",
      label: "Writer",
      kind: "choice",
      multiple: true,
      sortable: false,
      options: [
        { value: "pipeline", label: "Pipeline" },
        { value: "claude", label: "Claude note writer" },
        { value: "reader", label: "Reader" },
      ],
    },
    { id: "ratings", label: "Votes", hint: "Every vote on the note, the author's own included", kind: "count", thresholds: LARGE_COUNTS, bound: "atLeast", offerNone: true, sortable: true },
  ],
};

/** The submenus the A/B tests sit in, in the Filter and Compare menus. */
export const RECENT_TESTS = "A/B tests";
export const OLDER_TESTS = "Older A/B tests";

/** One field per A/B test. Tests that a run of the last 3 days varied come
 *  first, and the rest wait in their own submenu, so the menu stays short. */
export function abTestFields(tests: readonly AbTest[]): FieldDef[] {
  return [...tests]
    .sort((a, b) => Number(b.recentlyVaried) - Number(a.recentlyVaried))
    .map((test) => ({
      id: `picks.${test.name}`,
      label: test.name,
      group: test.recentlyVaried ? RECENT_TESTS : OLDER_TESTS,
      kind: "choice",
      multiple: true,
      sortable: false,
    }));
}

export const isAbField = (id: string) => id.startsWith("picks.");

/** The old page opened on the most viewed helpful notes, and so does this one. */
export const DEFAULT_NOTE_QUERY: FieldQuery = {
  filters: [{ field: "status", values: ["helpful"] }],
  sorts: [{ field: "views", descending: true }],
  display: [],
};
