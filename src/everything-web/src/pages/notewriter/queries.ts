import { useQuery } from "@tanstack/react-query";
import type { FieldDef, QueryRequest } from "@cn/core/fieldQuery";
import {
  fetchAbCombos,
  fetchAbReasons,
  fetchAbTests,
  fetchNoteDays,
  fetchNoteFacets,
  fetchNoteSummary,
  fetchOriginDays,
  fetchXNotePage,
  X_NOTE_PAGE_SIZE,
  type NotewriterSource,
  type XNote,
  type XNoteCursor,
} from "@cn/core/notewriter";
import type { Facet } from "@cn/features/fieldQuery/Filters";
import { queryKeys } from "@cn/features/query/queryKeys";
import { usePagedList } from "@cn/features/query/usePagedList";

/* The reads of the X notewriter page and the dashboard's notes, as TanStack
 * Query hooks. A changed filter keeps the old answer on screen until the new
 * one arrives, so the numbers and the chart do not flash empty. */

export const useNoteSummary = (source: NotewriterSource, request: QueryRequest) =>
  useQuery({ queryKey: queryKeys.noteSummary(source, request), queryFn: () => fetchNoteSummary(source, request), placeholderData: (previous) => previous });

export const useNoteDays = (source: NotewriterSource, request: QueryRequest, withRuns: boolean) =>
  useQuery({ queryKey: queryKeys.noteDays(source, request, withRuns), queryFn: () => fetchNoteDays(source, request, withRuns), placeholderData: (previous) => previous });

export const useOriginDays = (enabled: boolean) => useQuery({ queryKey: queryKeys.xOriginDays, queryFn: fetchOriginDays, enabled });

export const useAbTests = (source: NotewriterSource, enabled = true) => useQuery({ queryKey: queryKeys.abTests(source), queryFn: () => fetchAbTests(source), enabled });

export const useAbReasons = (source: NotewriterSource) => useQuery({ queryKey: queryKeys.abReasons(source), queryFn: () => fetchAbReasons(source) });

export const useAbCombos = (source: NotewriterSource, tests: string[], since: string | null) =>
  useQuery({
    queryKey: queryKeys.abCombos(source, tests, since),
    queryFn: () => fetchAbCombos(source, tests, since),
    enabled: tests.length > 0,
    placeholderData: (previous) => previous,
  });

/** How many notes each value of the choice fields would show, for the Filter
 *  menu. */
export function useNoteFacets(source: NotewriterSource, fields: readonly FieldDef[], request: QueryRequest): Record<string, Facet[]> | undefined {
  const columns = fields.flatMap((field) => (field.kind === "choice" ? [field.id] : []));
  return useQuery({
    queryKey: queryKeys.noteFacets(source, request),
    queryFn: async () => {
      const byField = await fetchNoteFacets(source, request, columns);
      return Object.fromEntries(Object.entries(byField).map(([field, values]) => [field, values.map((v) => ({ value: v.value, label: null, count: v.count }))]));
    },
    placeholderData: (previous) => previous,
  }).data;
}

/** A page shorter than a full page is the list's last. */
const nextCursor = (page: XNote[]): XNoteCursor | undefined => {
  const last = page.at(-1);
  return page.length === X_NOTE_PAGE_SIZE && last?.sortKey ? { key: last.sortKey, id: last.noteId } : undefined;
};

export const useXNoteList = (request: QueryRequest) =>
  usePagedList({
    queryKey: queryKeys.xNoteList(request),
    fetchPage: (cursor: XNoteCursor | null) => fetchXNotePage(request, cursor),
    firstBookmark: null as XNoteCursor | null,
    nextBookmark: nextCursor,
  });
