import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CROWD_RATINGS, REVIEW_SECTIONS, setApprovalRequired, type CrowdRating, type ReviewDraft, type ReviewSection, type ReviewSummary } from "@cn/core/claudeReview";
import { NO_FILTERS } from "@cn/core/feedPages";
import { queryKeys } from "@cn/features/query/queryKeys";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { Checkbox } from "@cn/ui/Field";
import { AdminOnly } from "../../components/AdminOnly";
import { NoteFiltersButton } from "../../components/NoteFiltersButton";
import { RouteLink } from "../../components/RouteLink";
import { PhoneSectionMenu, SidebarLayout, sidebarEntry } from "../../components/SidebarLayout";
import { parseNoteFilters } from "../../lib/feed";
import { useMomentFor } from "../../lib/feedQueries";
import type { Route } from "../../lib/routing";
import { useSettledValue } from "../../lib/useSettledValue";
import { useStoredValue } from "../../lib/useStoredValue";
import { PERSON, ReviewCard, type JudgeShown } from "./ReviewCard";
import { showNewDrafts, useLiveNotes, useNewDrafts, usePollWaitingChats, useReviewSection, useReviewSummary, type ReviewView } from "./reviewQueries";

const SECTION_TITLES: Record<ReviewSection, string> = {
  unreviewed: "Not reviewed",
  waiting: "Waiting for approval",
  approved: "Approved",
  disapproved: "Disapproved",
  no_note: "No note",
  skipped: "Skipped",
};
const EMPTY_SECTION: Record<ReviewSection, string> = {
  unreviewed: "Every posted note has been reviewed.",
  waiting: "No note is waiting for approval.",
  approved: "No note has been approved yet.",
  disapproved: "No note has been disapproved.",
  no_note: "No passage ended without a note.",
  skipped: "You have not skipped any note that is still open.",
};
const RATING_LABELS: Record<CrowdRating, string> = {
  helpful: "Rated helpful",
  upvoted: "Only Helpful or Somewhat helpful votes",
  other: "Everything else",
};
const RATINGS_KEY = "cn:noteReviewRatings";
/** The All notes page's filters on this page start with every note shown. */
const NOTE_FILTERS_KEY = "cn:noteReviewNoteFilters";
const JUDGE_SHOWN_KEY = "cn:noteReviewJudgeShown";

const parseRatings = (stored: string | null): CrowdRating[] => {
  try {
    const ratings = JSON.parse(stored ?? "null");
    return Array.isArray(ratings) ? CROWD_RATINGS.filter((r) => ratings.includes(r)) : [...CROWD_RATINGS];
  } catch {
    return [...CROWD_RATINGS];
  }
};
const parseJudgeShown = (stored: string | null): JudgeShown => {
  try {
    const shown = JSON.parse(stored ?? "null");
    return { helpful: shown?.helpful !== false, impactful: shown?.impactful !== false };
  } catch {
    return { helpful: true, impactful: true };
  }
};
/** Sections whose drafts wait for a reviewer get a highlighted count. */
const NEEDS_REVIEWER = new Set<ReviewSection>(["unreviewed", "waiting"]);

const sectionRoute = (section: ReviewSection): Route => ({ view: "noteReview", section });

function SectionList({ current, summary, navigate }: { current: ReviewSection; summary: ReviewSummary | undefined; navigate: (route: Route) => void }) {
  return (
    <nav aria-label="Sections">
      <ul className="space-y-0.5">
        {REVIEW_SECTIONS.map((section) => {
          const count = summary?.counts[section];
          const active = section === current;
          const highlighted = NEEDS_REVIEWER.has(section) && !!count;
          return (
            <li key={section}>
              <RouteLink
                to={sectionRoute(section)}
                navigate={navigate}
                current={active}
                className={cn(sidebarEntry(active), "justify-between gap-3")}
              >
                {SECTION_TITLES[section]}
                {count !== undefined && (
                  <span
                    className={cn(
                      "min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs tabular-nums",
                      highlighted ? "bg-caution-soft text-caution" : "bg-surface-muted text-fg-secondary",
                    )}
                  >
                    {count}
                  </span>
                )}
              </RouteLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Turns the approval step on or off for every reviewer. While it is on,
 *  Claude's new notes wait in "Waiting for approval". */
function ApprovalSwitch({ approvalRequired }: { approvalRequired: boolean }) {
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => setApprovalRequired(!approvalRequired),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.noteReviewSummaries }),
  });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={approvalRequired}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate()}
      title={approvalRequired ? "New notes wait for approval. Click to post them at once" : "New notes go up at once. Click to make them wait for approval"}
      className="flex items-center gap-2 rounded-full border border-line px-2 py-0.5 text-xs text-fg-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span className={cn("relative h-3.5 w-6 rounded-full transition-colors", approvalRequired ? "bg-primary" : "bg-line-strong")}>
        <span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-all", approvalRequired ? "left-3" : "left-0.5")} />
      </span>
      Approval before posting
    </button>
  );
}

/** Who is reviewing, who writes the notes, the approval switch, and which of
 *  the note judge's probabilities the cards show. */
function Settings({ summary, judgeShown, onJudgeShown }: { summary: ReviewSummary | undefined; judgeShown: JudgeShown; onJudgeShown: (shown: JudgeShown) => void }) {
  if (!summary) return null;
  return (
    <div className="space-y-3 text-xs text-fg-muted">
      <div className="space-y-1">
        <Checkbox checked={judgeShown.helpful} onChange={(helpful) => onJudgeShown({ ...judgeShown, helpful })}>
          Show the judge's P(helpful)
        </Checkbox>
        <Checkbox checked={judgeShown.impactful} onChange={(impactful) => onJudgeShown({ ...judgeShown, impactful })}>
          Show the judge's P(impactful)
        </Checkbox>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Reviewing as {PERSON[summary.reviewer]}</span>
        <span className="rounded-full border border-line px-2 py-0.5">{summary.writer === "claude" ? "Claude writes" : "Pipeline writes"}</span>
        <ApprovalSwitch approvalRequired={summary.approvalRequired} />
      </div>
    </div>
  );
}

/** The three crowd ratings a section can show. At least one stays on. */
function RatingFilter({ ratings, onChange }: { ratings: CrowdRating[]; onChange: (ratings: CrowdRating[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
      {CROWD_RATINGS.map((rating) => (
        <Checkbox
          key={rating}
          checked={ratings.includes(rating)}
          disabled={ratings.length === 1 && ratings.includes(rating)}
          onChange={(on) => onChange(CROWD_RATINGS.filter((r) => (r === rating ? on : ratings.includes(r))))}
        >
          {RATING_LABELS[rating]}
        </Checkbox>
      ))}
    </div>
  );
}

/** One loaded page of drafts. Each page reads the live notes of its own
 *  drafts, so loading the next page never reloads the notes above it. */
function DraftPage({ drafts, view, judgeShown }: { drafts: ReviewDraft[]; view: ReviewView; judgeShown: JudgeShown }) {
  const liveNotes = useLiveNotes(drafts);
  return drafts.map((draft) => (
    <ReviewCard key={draft.id} draft={draft} liveNote={draft.noteId ? liveNotes?.get(draft.noteId) : undefined} view={view} judgeShown={judgeShown} />
  ));
}

function SectionFeed({ view, judgeShown }: { view: ReviewView; judgeShown: JudgeShown }) {
  const client = useQueryClient();
  const list = useReviewSection(view);
  const pages = list.pages;
  const drafts = pages?.flat();
  const newDrafts = useNewDrafts(view, drafts);
  usePollWaitingChats(view, drafts ?? []);

  if (list.failed) return <LoadFailed what="These drafts" onRetry={list.retry} className="mx-auto max-w-[40rem]" />;
  if (!pages || !drafts) return <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>;
  return (
    <div className="space-y-6">
      {newDrafts.length > 0 && (
        <div className="mx-auto max-w-[40rem]">
          <Button variant="secondary" className="w-full" onClick={() => showNewDrafts(client, view, newDrafts)}>
            {newDrafts.length === 1 ? "1 new draft. Show it" : `${newDrafts.length} new drafts. Show them`}
          </Button>
        </div>
      )}
      {drafts.length === 0 && <p className="mx-auto max-w-[40rem] py-12 text-center text-sm text-fg-muted">{EMPTY_SECTION[view.section]}</p>}
      {pages.map((page, index) => (
        <DraftPage key={index} drafts={page} view={view} judgeShown={judgeShown} />
      ))}
      {drafts.length > 0 && <PagedListEnd list={list} endText="That is every draft in this section." className="mx-auto max-w-[40rem]" />}
    </div>
  );
}

/** The admins' review of the Claude note writer's notes. A sidebar lists the
 *  sections with their counts, and the open section's drafts load page by
 *  page as the admin scrolls. Above the drafts, three checkboxes narrow every
 *  section to how the crowd rated the notes, and the All notes page's Filters
 *  button narrows it by views and votes and hides the notes the admin voted
 *  on. On a phone the sidebar becomes a menu
 *  above the drafts. Anyone who is not an admin sees only a short message, and
 *  the database refuses them every draft and every step. */
export function NoteReviewPage({ section, navigate }: { section: ReviewSection; navigate: (route: Route) => void }) {
  return (
    <AdminOnly>
      <NoteReview section={section} navigate={navigate} />
    </AdminOnly>
  );
}

function NoteReview({ section, navigate }: { section: ReviewSection; navigate: (route: Route) => void }) {
  const [ratings, setRatings] = useStoredValue(RATINGS_KEY, parseRatings, JSON.stringify);
  const [noteFilters, setNoteFilters] = useStoredValue(NOTE_FILTERS_KEY, (stored) => parseNoteFilters(stored, NO_FILTERS), JSON.stringify);
  // A slider sends its value only once it has stopped moving, and the moment
  // that "only notes I haven't voted on" counts from is taken anew whenever a
  // filter changes.
  const settledNoteFilters = useSettledValue(noteFilters);
  const votedBefore = useMomentFor(JSON.stringify([settledNoteFilters, ratings]));
  const filters = useMemo(() => ({ ...settledNoteFilters, ratings, votedBefore }), [settledNoteFilters, ratings, votedBefore]);
  const [judgeShown, setJudgeShown] = useStoredValue(JUDGE_SHOWN_KEY, parseJudgeShown, JSON.stringify);
  const view = useMemo(() => ({ section, filters }), [section, filters]);
  const summary = useReviewSummary(filters);
  const settings = <Settings summary={summary.data} judgeShown={judgeShown} onJudgeShown={setJudgeShown} />;
  const sidebar = (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
      <h1 className="px-3 font-title text-lg font-bold text-fg">Note review</h1>
      <SectionList current={section} summary={summary.data} navigate={navigate} />
      <div className="mt-auto px-3">{settings}</div>
    </div>
  );
  return (
    <SidebarLayout storageKey="cn:noteReviewSidebarWidth" sidebar={sidebar}>
      <div className="mx-auto mb-6 max-w-[40rem] space-y-3 md:hidden">
        <h1 className="font-title text-2xl font-bold text-fg">Note review</h1>
        <PhoneSectionMenu
          sections={REVIEW_SECTIONS}
          value={section}
          titles={SECTION_TITLES}
          counts={summary.data?.counts}
          onChange={(next) => navigate(sectionRoute(next))}
        />
        {settings}
      </div>
      {summary.isError && <p className="mx-auto mb-4 max-w-[40rem] text-sm text-negative">{summary.error.message}</p>}
      <div className="mx-auto mb-6 max-w-[40rem] space-y-3">
        <h2 className="hidden font-title text-2xl font-bold text-fg md:block">{SECTION_TITLES[section]}</h2>
        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <RatingFilter ratings={ratings} onChange={setRatings} />
          {summary.data && (
            <NoteFiltersButton
              filters={noteFilters}
              onChange={setNoteFilters}
              largest={summary.data.largest}
              matchingNotes={summary.data.counts[section]}
              defaults={NO_FILTERS}
            />
          )}
        </div>
      </div>
      <SectionFeed key={`${section}:${JSON.stringify(filters)}`} view={view} judgeShown={judgeShown} />
    </SidebarLayout>
  );
}
