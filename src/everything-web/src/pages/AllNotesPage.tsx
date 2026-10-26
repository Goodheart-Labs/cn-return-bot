import { useCallback, useState } from "react";
import type { FeedOrder, NoteFilters, NoteMinimums } from "@cn/core/feedPages";
import type { ProjectHeader } from "@cn/core/types";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { BackToProjects } from "../components/BackToProjects";
import { CreatorLink } from "../components/CreatorLink";
import { NoteFeed, type FeedCard } from "../components/NoteFeed";
import { NoteFiltersButton } from "../components/NoteFiltersButton";
import { ageLabel, ageTotal, BAND_LABELS, bandTotal, DEFAULT_NOTE_FILTERS, MINIMUM_KEYS, spanStarts } from "../lib/feed";
import { useNoteFeed, type FeedEntry } from "../lib/feedQueries";
import type { Route } from "../lib/routing";
import { useSettledValue } from "../lib/useSettledValue";
import { useStoredChoice, useStoredValue } from "../lib/useStoredValue";

const ORDERS: { id: FeedOrder; label: string }[] = [
  { id: "recent", label: "Newest" },
  { id: "mixed", label: "Mixed" },
  { id: "helpful", label: "Most helpful" },
];

/** The order the reader picked last time, remembered on this device. */
const ORDER_KEY = "cn:allNotesOrder";

/** The filters the reader set last time, remembered on this device. */
const FILTERS_KEY = "cn:allNotesFilters";

/** The whole site, as the feed's scope. */
const EVERY_PROJECT = { projectId: null, itemId: null };

/** Reads the remembered filters. A minimum that is missing, or is not a whole
 *  number of at least zero, gets its default. So does a checkbox that is
 *  missing or not true or false. */
function parseFilters(stored: string | null): NoteFilters {
  let parsed: Partial<Record<keyof NoteFilters, unknown>> = {};
  try {
    parsed = JSON.parse(stored ?? "{}") ?? {};
  } catch {
    // Unreadable text means nothing usable was stored.
  }
  const validMinimum = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
  const minimums = MINIMUM_KEYS.map((key) => [key, validMinimum(parsed[key]) ? parsed[key] : DEFAULT_NOTE_FILTERS[key]]);
  const unvotedOnly = typeof parsed.unvotedOnly === "boolean" ? parsed.unvotedOnly : DEFAULT_NOTE_FILTERS.unvotedOnly;
  return { ...(Object.fromEntries(minimums) as NoteMinimums), unvotedOnly };
}

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
  const [filters, setFilters] = useStoredValue(FILTERS_KEY, parseFilters, JSON.stringify);
  // The Newest order's dividers are drawn on the reader's calendar, from the
  // moment the page opened.
  const [starts] = useState(() => spanStarts(new Date()));
  const { list, summary } = useNoteFeed(EVERY_PROJECT, order, useSettledValue(filters), order === "recent" ? starts : []);
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
            {counts && <NoteFiltersButton filters={filters} onChange={setFilters} largest={counts.largest} matchingNotes={counts.matching} />}
          </div>
        </div>
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
