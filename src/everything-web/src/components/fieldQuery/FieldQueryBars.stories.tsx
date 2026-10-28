import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { FieldQuery } from "@cn/core/fieldQuery";
import { DEFAULT_REVIEW_QUERY, DISPLAY, REVIEW_FIELDS } from "../../pages/noteReview/reviewFields";
import { DisplayMenu } from "./DisplayMenu";
import { FilterBar, type Facet } from "./FilterBar";
import { SortBar } from "./SortBar";

const meta = { title: "Website/Filter, sort and display" } satisfies Meta;
export default meta;

/** Made-up creators, enough that their list scrolls and gets a search box. */
const CREATORS: Facet[] = Array.from({ length: 30 }, (_, i) => ({ value: `creator-${i + 1}`, label: `Creator number ${i + 1}`, count: 30 - i }));
const FACETS: Record<string, Facet[]> = {
  creator: CREATORS,
  on_x: [
    { value: "not_posted", label: null, count: 512 },
    { value: "posted", label: null, count: 9 },
    { value: "wont_post", label: null, count: 4 },
  ],
};

/** The review page's three controls with its real fields, as in the page's
 *  header. The query below them shows what the page would send. */
export const ReviewPage: StoryObj = {
  render: function Render() {
    const [query, setQuery] = useState<FieldQuery>(DEFAULT_REVIEW_QUERY);
    return (
      <div className="mx-auto max-w-[40rem] space-y-3 p-8">
        <div className="flex justify-end">
          <DisplayMenu options={Object.values(DISPLAY)} shown={query.display} onChange={(display) => setQuery({ ...query, display })} />
        </div>
        <FilterBar fields={REVIEW_FIELDS} filters={query.filters} onChange={(filters) => setQuery({ ...query, filters })} facets={FACETS} />
        <SortBar fields={REVIEW_FIELDS} sorts={query.sorts} onChange={(sorts) => setQuery({ ...query, sorts })} />
        <pre className="text-2xs text-fg-muted">{JSON.stringify(query, null, 2)}</pre>
      </div>
    );
  },
};
