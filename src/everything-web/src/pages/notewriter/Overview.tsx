import { useMemo } from "react";
import { buildRequest, type FieldDef, type FieldFilter, type FieldQuery, type QueryRequest } from "@cn/core/fieldQuery";
import type { NotewriterSource } from "@cn/core/notewriter";
import { FilterButton, FilterPills, type Facet } from "@cn/features/fieldQuery/Filters";
import { SortBar } from "@cn/features/fieldQuery/SortBar";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import { StatTile } from "@cn/ui/StatTile";
import { SectionTitle } from "@cn/ui/typography";
import { useMomentFor } from "../../lib/feedQueries";
import { isAbField } from "./noteFields";
import { NotesOverTime, type ChartMode } from "./NotesOverTime";
import { useNoteFacets, useNoteSummary, useXNoteList } from "./queries";
import { XNoteCard } from "./XNoteCard";

const formatCount = (n: number | undefined) => (n === undefined ? "…" : n.toLocaleString("en-US"));

/** The headline numbers of the notes the filters let through. X counts how
 *  often it showed our notes. Common Notes does not, so there the first tile
 *  counts the notes. */
export function Numbers({ source, request }: { source: NotewriterSource; request: QueryRequest }) {
  const summary = useNoteSummary(source, request);
  if (summary.isError) return <LoadFailed what="The numbers" onRetry={() => void summary.refetch()} />;
  return (
    <div className="flex flex-wrap gap-3">
      <StatTile label="Helpful notes" value={formatCount(summary.data?.helpful)} />
      {source === "x" ? (
        <StatTile label="Views on our notes" value={formatCount(summary.data?.views)} />
      ) : (
        <StatTile label="Notes" value={formatCount(summary.data?.notes)} />
      )}
    </div>
  );
}

/** The props of one Filter button and its pills, over a part of the query's
 *  fields. Changing them keeps the filters of the other fields. */
export function filterScope(fields: readonly FieldDef[], query: FieldQuery, onQueryChange: (query: FieldQuery) => void, facets: Record<string, Facet[]> | undefined) {
  const inScope = (filter: FieldFilter) => fields.some((field) => field.id === filter.field);
  const others = query.filters.filter((filter) => !inScope(filter));
  return {
    fields,
    filters: query.filters.filter(inScope),
    facets,
    onChange: (filters: FieldFilter[]) => onQueryChange({ ...query, filters: [...others, ...filters] }),
  };
}

function NoteList({ request }: { request: QueryRequest }) {
  const list = useXNoteList(request);
  const notes = list.pages?.flat();
  if (list.failed) return <LoadFailed what="These notes" onRetry={list.retry} />;
  if (!notes) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (notes.length === 0) return <p className="py-12 text-center text-sm text-fg-muted">No notes match these filters.</p>;
  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <XNoteCard key={note.noteId} note={note} />
      ))}
      <PagedListEnd list={list} endText="That is every note that matches." />
    </div>
  );
}

const PUBLIC_MODES: ChartMode[] = ["counts", "posted", "share"];
const DEVELOPER_MODES: ChartMode[] = ["counts", "posted", "ratio", "share"];

/** The X page without the A/B comparison: the headline numbers, the chart and
 *  our notes. In developer mode the A/B test filters at the top narrow all
 *  three. The note list's own filters and sorts narrow only the list. Both
 *  live in one query, so the page address carries all of them. */
export function Overview({ fields, query, onQueryChange, devMode }: {
  fields: readonly FieldDef[];
  query: FieldQuery;
  onQueryChange: (query: FieldQuery) => void;
  devMode: boolean;
}) {
  const abFields = fields.filter((field) => isAbField(field.id));
  const listFields = fields.filter((field) => !isAbField(field.id));
  // Date filters count back from this moment, which is taken anew whenever
  // the filters change.
  const now = useMomentFor(JSON.stringify(query.filters));
  const abFilters = useMemo(() => query.filters.filter((filter) => isAbField(filter.field)), [query.filters]);
  const pageRequest = useMemo(() => buildRequest(fields, { filters: abFilters, sorts: [] }, now), [fields, abFilters, now]);
  const listRequest = useMemo(() => buildRequest(fields, query, now), [fields, query, now]);
  // Each Filter button counts its values under the filters that narrow what
  // it narrows: the A/B filters the whole page, the list's own the list.
  const abProps = filterScope(abFields, query, onQueryChange, useNoteFacets("x", abFields, pageRequest));
  const listProps = filterScope(listFields, query, onQueryChange, useNoteFacets("x", listFields, listRequest));

  return (
    <div className="space-y-8">
      {devMode && abFields.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterButton {...abProps} />
          <FilterPills {...abProps} />
        </div>
      )}
      <Numbers source="x" request={pageRequest} />
      <NotesOverTime source="x" request={pageRequest} modes={devMode ? DEVELOPER_MODES : PUBLIC_MODES} />
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>Notes</SectionTitle>
          <FilterButton {...listProps} />
        </div>
        <FilterPills {...listProps} />
        <SortBar fields={listFields} sorts={query.sorts} onChange={(sorts) => onQueryChange({ ...query, sorts })} />
        <NoteList key={JSON.stringify(listRequest)} request={listRequest} />
      </section>
    </div>
  );
}
