import { useCallback, useState } from "react";
import type { FeedOrder } from "@cn/core/feedPages";
import type { FieldFilter } from "@cn/core/fieldQuery";
import type { ProjectHeader } from "@cn/core/types";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { BackToProjects } from "../components/BackToProjects";
import { CreatorLink } from "../components/CreatorLink";
import { NoteFeed, type FeedCard } from "../components/NoteFeed";
import { FilterButton, FilterPills } from "@cn/features/fieldQuery/Filters";
import { ageLabel, ageTotal, ALL_NOTES_FIELDS, BAND_LABELS, bandTotal, DEFAULT_ALL_NOTES_QUERY, noteFiltersOf, spanStarts } from "../lib/feed";
import { useNoteFeed, type FeedEntry } from "../lib/feedQueries";
import type { Route } from "../lib/routing";
import { useFieldQuery } from "@cn/features/fieldQuery/useFieldQuery";
import { useStoredChoice } from "../lib/useStoredValue";

const ORDERS: { id: FeedOrder; label: string }[] = [
  { id: "recent", label: "Newest" },
  { id: "mixed", label: "Mixed" },
  { id: "helpful", label: "Most helpful" },
];

/** The order the reader picked last time, remembered on this device. */
const ORDER_KEY = "cn:allNotesOrder";

/** The filters the reader set last time, remembered on this device. Renamed
 *  when the sliders became the Filter menu (GOO-628). */
const QUERY_KEY = "cn:allNotesQuery";

/** The whole site, as the feed's scope. */
const EVERY_PROJECT = { projectId: null, itemId: null };

/** The creator a note belongs to, at the top of its card. It links to the
 *  creator's own page of notes. Beside it stands how many readers saw the notes
 *  on the post. */
function CreatorByline({ project, views, navigate }: { project: ProjectHeader; views: number; navigate: (route: Route) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <CreatorLink project={project} navigate={navigate} />
      <span className="text-sm text-fg-muted" title="Readers outside our team who were shown the notes on this post">
        {views === 1 ? "1 view" : `${views} views`}
      </span>
    </div>
  );
}

/** Every note of every project in one feed, loaded a page at a time as the
 *  reader scrolls. The reader picks the order: the newest notes first, the
 *  mixed order every project page uses, or the most helpful first. Filters
 *  hide notes the reader voted on and notes below a minimum of views or votes.
 *  By default the page shows only notes the reader has not voted on, on posts
 *  that at least 5 readers saw. Each card names its creator. */
export function AllNotesPage({ navigate }: { navigate: (route: Route) => void }) {
  const [order, setOrder] = useStoredChoice(ORDER_KEY, ORDERS.map((o) => o.id), "recent");
  const [query, setQuery] = useFieldQuery({ storageKey: QUERY_KEY, fields: ALL_NOTES_FIELDS, displayOptions: [], defaults: DEFAULT_ALL_NOTES_QUERY });
  // The Newest order's dividers are drawn on the reader's calendar, from the
  // moment the page opened.
  const [starts] = useState(() => spanStarts(new Date()));
  const filterProps = { fields: ALL_NOTES_FIELDS, filters: query.filters, onChange: (filters: FieldFilter[]) => setQuery({ ...query, filters }) };
  const { list, summary } = useNoteFeed(EVERY_PROJECT, order, noteFiltersOf(query.filters), order === "recent" ? starts : []);
  const counts = summary.data;
  const byline = useCallback(
    ({ entry, project }: FeedCard<FeedEntry>) => project && <CreatorByline project={project} views={entry.views} navigate={navigate} />,
    [navigate],
  );

  return (
    <main className="min-w-0 px-4 py-8 md:px-8">
      <div className="mx-auto mb-6 max-w-[40rem] space-y-4">
        <BackToProjects navigate={navigate} />
        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-title text-2xl font-bold text-fg">All notes</h1>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl label="Order" options={ORDERS} value={order} onChange={setOrder} />
            <FilterButton {...filterProps} />
          </div>
        </div>
        {counts && <p className="text-sm text-fg-muted">{counts.matching === 1 ? "1 note matches" : `${counts.matching} notes match`}</p>}
        <FilterPills {...filterProps} />
      </div>
      <NoteFeed
        list={list}
        labelOf={({ entry, note }) => (order === "recent" ? ageLabel(note.created_at, starts) : BAND_LABELS[entry.band])}
        totalOf={(label) => (order === "recent" ? ageTotal(counts, label) : bandTotal(counts, label))}
        byline={byline}
        emptyText="No notes match these filters."
      />
    </main>
  );
}
