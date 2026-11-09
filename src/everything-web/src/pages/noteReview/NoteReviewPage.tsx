import { useMemo, type ComponentProps, type ReactNode } from "react";
import type { ReviewDraft, ReviewSummary } from "@cn/core/claudeReview";
import { buildRequest, type FieldDef, type FieldFilter } from "@cn/core/fieldQuery";
import type { NotewriterSource } from "@cn/core/notewriter";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import { Button } from "@cn/ui/Button";
import { Page } from "@cn/ui/Page";
import { PageTitle } from "@cn/ui/typography";
import { AdminOnly } from "../../components/AdminOnly";
import { SidebarPagesLayout, type SidebarPage } from "../../components/SidebarLayout";
import { CardColumn } from "../../components/ClaimCard";
import { DisplayMenu } from "@cn/features/fieldQuery/DisplayMenu";
import { FilterButton, FilterPills } from "@cn/features/fieldQuery/Filters";
import { SortBar } from "@cn/features/fieldQuery/SortBar";
import { useMomentFor } from "../../lib/feedQueries";
import { useFieldQuery } from "@cn/features/fieldQuery/useFieldQuery";
import { NOTE_REVIEW, X_NOTE_REVIEW, type Route } from "../../lib/routing";
import { abTestFields, DEFAULT_X_REVIEW_QUERY, X_REVIEW_FIELDS } from "../notewriter/noteFields";
import { NoteList } from "../notewriter/Overview";
import { useAbTests, useNoteFacets, useNoteSummary } from "../notewriter/queries";
import { ReviewCard } from "./ReviewCard";
import { PERSON } from "./ReviewerVotes";
import { DEFAULT_REVIEW_QUERY, DISPLAY, REVIEW_FIELDS } from "./reviewFields";
import { useLiveNotes, useNewDrafts, usePollWaitingChats, useReviewFacets, useReviewList, useReviewSummary, type ReviewView } from "./reviewQueries";
import { TWEET_SERVER } from "./tweetServer";
import { useTypefullySync } from "./typefullySync";

/** The Display menu offers Post on X only in the local posting tool, which
 *  has a server that can reach Typefully. */
const DISPLAY_OPTIONS = Object.values(DISPLAY);

const QUERY_KEY = "cn:noteReviewQuery";
const X_QUERY_KEY = "cn:xNoteReviewQuery";

/** Who is reviewing, and how many notes match. */
function WhoLine({ summary }: { summary: ReviewSummary | undefined }) {
  if (!summary) return null;
  return (
    <p className="text-sm text-fg-muted">
      Reviewing as {PERSON[summary.reviewer]} ·{" "}
      {summary.matching === 1 ? "1 matching note" : `${summary.matching} matching notes`}
    </p>
  );
}

/** One loaded page of drafts. Each page reads the live notes of its own
 *  drafts, so loading the next page never reloads the notes above it. */
function DraftPage({ drafts, view }: { drafts: ReviewDraft[]; view: ReviewView }) {
  const liveNotes = useLiveNotes(drafts);
  return drafts.map((draft) => {
    const liveNote = draft.noteId ? liveNotes?.get(draft.noteId) : undefined;
    const originalId = liveNote?.improved_from_note_id;
    return (
      <ReviewCard
        key={draft.id}
        draft={draft}
        liveNote={liveNote}
        improvesOn={originalId ? (liveNotes?.get(originalId) ?? null) : undefined}
        view={view}
      />
    );
  });
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

const SOURCES: SidebarPage<NotewriterSource>[] = [
  { id: "commonnotes", label: "Common Notes", route: NOTE_REVIEW },
  { id: "x", label: "X", route: X_NOTE_REVIEW },
];

/** The page's header: the title with a line on what is shown, the Filter
 *  button and any menus beside it, any notices, the filter pills and the
 *  sort bar. */
function ReviewHeader({ who, filterProps, menus, notices, sortBar }: {
  who: ReactNode;
  filterProps: ComponentProps<typeof FilterButton>;
  menus?: ReactNode;
  notices?: ReactNode;
  sortBar: ReactNode;
}) {
  return (
    // The controls span the page's whole width, so the pills have room on one
    // line, and the menus open to the left of the buttons at its right edge.
    <header className="mb-10 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <PageTitle>Note review</PageTitle>
          {who}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FilterButton {...filterProps} />
          {menus}
        </div>
      </div>
      {notices}
      <FilterPills {...filterProps} />
      {sortBar}
    </header>
  );
}

/** The admins' review of the notes of both notewriters, one page each in a
 *  sidebar. The Common Notes page holds the Claude note writer's notes, which
 *  is also where Nathan picks notes to post on X. The X page holds every note
 *  we submitted to X, where our votes go on the note's twin. The local
 *  posting tool posts only Common Notes, so it shows that page alone. On
 *  both, a Filter button narrows the list
 *  by any field and a Sort bar orders it by any number of fields, and both
 *  live in the page address and are remembered on the device. The notes load
 *  page by page as the admin scrolls. Anyone who is not an admin sees only a
 *  short message, and the database refuses them every draft and every step. */
export function NoteReviewPage({ source, navigate }: { source: NotewriterSource; navigate: (route: Route) => void }) {
  const content = source === "x" ? <XReview /> : <NoteReview />;
  return (
    <AdminOnly>
      {TWEET_SERVER ? (
        <Page width="full">{content}</Page>
      ) : (
        <SidebarPagesLayout storageKey="cn:noteReviewSidebarWidth" label="Note review pages" pages={SOURCES} current={source} navigate={navigate}>
          {content}
        </SidebarPagesLayout>
      )}
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
  const typefully = useTypefullySync();
  const view = useMemo(() => ({ request, sorts: query.sorts, display: query.display, now }), [request, query.sorts, query.display, now]);
  return (
    <>
      <ReviewHeader
        who={<WhoLine summary={summary.data} />}
        filterProps={filterProps}
        menus={<DisplayMenu options={DISPLAY_OPTIONS} shown={query.display} onChange={(display) => setQuery({ ...query, display })} />}
        notices={
          <>
            {summary.isError && <p className="text-sm text-negative">{summary.error.message}</p>}
            {typefully.isError && <p className="text-sm text-negative">Could not check Typefully: {typefully.error.message}</p>}
            {!!typefully.data?.failed && (
              <p className="text-sm text-negative">
                Typefully could not publish {typefully.data.failed === 1 ? "1 tweet" : `${typefully.data.failed} tweets`}. Fix them in Typefully.
              </p>
            )}
          </>
        }
        sortBar={<SortBar fields={REVIEW_FIELDS} sorts={query.sorts} onChange={(sorts) => setQuery({ ...query, sorts })} />}
      />
      <ReviewFeed key={JSON.stringify(request)} view={view} />
    </>
  );
}

/** The X side waits for the A/B tests, because each test is a field and the
 *  fields are fixed for the life of the query. */
function XReview() {
  const tests = useAbTests("x");
  if (tests.isError) return <LoadFailed what="The A/B tests" onRetry={() => void tests.refetch()} />;
  if (!tests.data) return <p className="text-sm text-fg-muted">Loading…</p>;
  return <XReviewWithFields fields={[...X_REVIEW_FIELDS, ...abTestFields(tests.data)]} />;
}

function XReviewWithFields({ fields }: { fields: FieldDef[] }) {
  const [query, setQuery] = useFieldQuery({ storageKey: X_QUERY_KEY, fields, displayOptions: [], defaults: DEFAULT_X_REVIEW_QUERY });
  const now = useMomentFor(JSON.stringify([query.filters, query.sorts]));
  const request = useMemo(() => buildRequest(fields, query, now), [fields, query, now]);
  const summary = useNoteSummary("x", request);
  const facets = useNoteFacets("x", fields, request);
  const filterProps = { fields, filters: query.filters, onChange: (filters: FieldFilter[]) => setQuery({ ...query, filters }), facets };
  const matching = summary.data?.notes;
  return (
    <>
      <ReviewHeader
        who={matching !== undefined && <p className="text-sm text-fg-muted">{matching === 1 ? "1 matching note" : `${matching.toLocaleString("en-US")} matching notes`}</p>}
        filterProps={filterProps}
        notices={summary.isError && <p className="text-sm text-negative">{summary.error.message}</p>}
        sortBar={<SortBar fields={fields} sorts={query.sorts} onChange={(sorts) => setQuery({ ...query, sorts })} />}
      />
      <NoteList key={JSON.stringify(request)} request={request} showReviewers />
    </>
  );
}
