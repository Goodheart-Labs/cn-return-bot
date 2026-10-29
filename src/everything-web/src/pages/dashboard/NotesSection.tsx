import { useMemo } from "react";
import { buildRequest, type FieldDef } from "@cn/core/fieldQuery";
import { FilterButton, FilterPills } from "@cn/features/fieldQuery/Filters";
import { useFieldQuery } from "@cn/features/fieldQuery/useFieldQuery";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { useMomentFor } from "../../lib/feedQueries";
import { abTestFields, NOTE_FIELDS } from "../notewriter/noteFields";
import { NotesOverTime, type ChartMode } from "../notewriter/NotesOverTime";
import { filterScope, Numbers } from "../notewriter/Overview";
import { useAbTests, useNoteFacets } from "../notewriter/queries";

const MODES: ChartMode[] = ["counts", "posted", "ratio"];
const NO_QUERY = { filters: [], sorts: [], display: [] };

function FilteredNotes({ fields }: { fields: readonly FieldDef[] }) {
  const [query, setQuery] = useFieldQuery({ storageKey: "cn:dashboardNotesQuery", fields, displayOptions: [], defaults: NO_QUERY });
  // Date filters count back from this moment, which is taken anew whenever
  // the filters change.
  const now = useMomentFor(JSON.stringify(query.filters));
  const request = useMemo(() => buildRequest(fields, query, now), [fields, query, now]);
  const filterProps = filterScope(fields, query, setQuery, useNoteFacets("commonnotes", fields, request));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <FilterButton {...filterProps} />
        <FilterPills {...filterProps} />
      </div>
      <Numbers source="commonnotes" request={request} />
      <NotesOverTime source="commonnotes" request={request} modes={MODES} />
    </div>
  );
}

/** The notes on commonnotes.net by the day they were written and their
 *  rating, as the X notewriter page shows ours on X. The Filter narrows the
 *  numbers and the chart, by the notes' own fields and by the arms of the A/B
 *  tests that Common Notes' claim checks varied. */
export function NotesSection() {
  const tests = useAbTests("commonnotes");
  if (tests.isError) return <LoadFailed what="The A/B tests" onRetry={() => void tests.refetch()} />;
  if (!tests.data) return <p className="text-sm text-fg-muted">Loading…</p>;
  return <FilteredNotes fields={[...NOTE_FIELDS.commonnotes, ...abTestFields(tests.data)]} />;
}
