import { useMemo } from "react";
import type { ReviewDraft, ReviewSummary } from "@cn/core/claudeReview";
import { buildRequest, type FieldFilter } from "@cn/core/fieldQuery";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import { Button } from "@cn/ui/Button";
import { AdminOnly } from "../../components/AdminOnly";
import { CardColumn } from "../../components/ClaimCard";
import { DisplayMenu } from "../../components/fieldQuery/DisplayMenu";
import { FilterButton, FilterPills } from "../../components/fieldQuery/Filters";
import { SortBar } from "../../components/fieldQuery/SortBar";
import { useMomentFor } from "../../lib/feedQueries";
import { useFieldQuery } from "../../lib/useFieldQuery";
import { PERSON, ReviewCard } from "./ReviewCard";
import { DEFAULT_REVIEW_QUERY, DISPLAY, REVIEW_FIELDS } from "./reviewFields";
import { useLiveNotes, useNewDrafts, usePollWaitingChats, useReviewFacets, useReviewList, useReviewSummary, type ReviewView } from "./reviewQueries";
import { TWEET_SERVER } from "./tweetServer";

/** The Display menu offers Post on X only in the local posting tool, which
 *  has a server that can reach Typefully. */
const DISPLAY_OPTIONS = Object.values(DISPLAY).filter((option) => option !== DISPLAY.postOnX || TWEET_SERVER);

const QUERY_KEY = "cn:noteReviewQuery";

/** Who is reviewing, who writes the notes, and how many notes match. */
function WhoLine({ summary }: { summary: ReviewSummary | undefined }) {
  if (!summary) return null;
  return (
    <p className="text-sm text-fg-muted">
      Reviewing as {PERSON[summary.reviewer]} · {summary.writer === "claude" ? "Claude writes the notes" : "The pipeline writes the notes"} ·{" "}
      {summary.matching === 1 ? "1 matching note" : `${summary.matching} matching notes`}
    </p>
  );
}

/** One loaded page of drafts. Each page reads the live notes of its own
 *  drafts, so loading the next page never reloads the notes above it. */
function DraftPage({ drafts, view }: { drafts: ReviewDraft[]; view: ReviewView }) {
  const liveNotes = useLiveNotes(drafts);
  return drafts.map((draft) => (
    <ReviewCard key={draft.id} draft={draft} liveNote={draft.noteId ? liveNotes?.get(draft.noteId) : undefined} view={view} />
  ));
}

/** The pages with every draft shown once. A draft an admin changed keeps its
 *  place, so a later page can bring it again at its new place. */
function withoutRepeats(pages: ReviewDraft[][]): ReviewDraft[][] {
  const seen = new Set<string>();
  return pages.map((page) => page.filter((draft) => !seen.has(draft.id) && seen.add(draft.id)));
}

function ReviewFeed({ view }: { view: ReviewView }) {
  const list = useReviewList(view.request);
  const pages = list.pages && withoutRepeats(list.pages);
  const drafts = pages?.flat();
  const newDrafts = useNewDrafts(view.request, drafts !== undefined);
  usePollWaitingChats(view.request, drafts ?? []);

  if (list.failed)
    return (
      <CardColumn>
        <LoadFailed what="These notes" onRetry={list.retry} />
      </CardColumn>
    );
  if (!pages || !drafts)
    return (
      <CardColumn>
        <p className="text-sm text-fg-muted">Loading…</p>
      </CardColumn>
    );
  return (
    <div className="space-y-6">
      {newDrafts.arrived && (
        <CardColumn>
          <Button variant="secondary" className="w-full" onClick={newDrafts.showThem}>
            New notes arrived. Show them
          </Button>
        </CardColumn>
      )}
      {drafts.length === 0 && (
        <CardColumn>
          <p className="py-12 text-center text-sm text-fg-muted">No notes match these filters.</p>
        </CardColumn>
      )}
      {pages.map((page, index) => (
        <DraftPage key={index} drafts={page} view={view} />
      ))}
      {drafts.length > 0 && (
        <CardColumn>
          <PagedListEnd list={list} endText="That is every note that matches." />
        </CardColumn>
      )}
    </div>
  );
}

/** The admins' review of the Claude note writer's notes, which is also where
 *  Nathan picks notes to post on X. A Filter button narrows the list by any
 *  field, a Sort bar orders it by any number of fields, and a Display button
 *  picks the buttons each card shows. All three live in the page address and
 *  are remembered on the device. The drafts load page by page as the admin
 *  scrolls. Anyone who is not an admin sees only a short message, and the
 *  database refuses them every draft and every step. */
export function NoteReviewPage() {
  return (
    <AdminOnly>
      <NoteReview />
    </AdminOnly>
  );
}

function NoteReview() {
  const [query, setQuery] = useFieldQuery({
    storageKey: QUERY_KEY,
    fields: REVIEW_FIELDS,
    displayOptions: DISPLAY_OPTIONS.map((option) => option.value),
    defaults: DEFAULT_REVIEW_QUERY,
  });
  // Date filters and buckets count back from this moment, which is taken anew
  // whenever the filters or sorts change.
  const now = useMomentFor(JSON.stringify([query.filters, query.sorts]));
  const request = useMemo(() => buildRequest(REVIEW_FIELDS, query, now), [query, now]);
  const summary = useReviewSummary(request);
  const facets = useReviewFacets(REVIEW_FIELDS, request);
  const filterProps = { fields: REVIEW_FIELDS, filters: query.filters, onChange: (filters: FieldFilter[]) => setQuery({ ...query, filters }), facets };
  const view = useMemo(() => ({ request, sorts: query.sorts, display: query.display, now }), [request, query.sorts, query.display, now]);
  return (
    <main className="min-w-0 px-4 py-8 md:px-8">
      {/* The controls span the page's whole width, so the pills have room on
          one line, and the menus open to the left of the buttons at its right
          edge. */}
      <header className="mb-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h1 className="font-title text-2xl font-bold text-fg">Note review</h1>
            <WhoLine summary={summary.data} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <FilterButton {...filterProps} />
            <DisplayMenu options={DISPLAY_OPTIONS} shown={query.display} onChange={(display) => setQuery({ ...query, display })} />
          </div>
        </div>
        {summary.isError && <p className="text-sm text-negative">{summary.error.message}</p>}
        <FilterPills {...filterProps} />
        <SortBar fields={REVIEW_FIELDS} sorts={query.sorts} onChange={(sorts) => setQuery({ ...query, sorts })} />
      </header>
      <ReviewFeed key={JSON.stringify(request)} view={view} />
    </main>
  );
}
