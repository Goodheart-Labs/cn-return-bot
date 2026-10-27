import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CROWD_RATINGS, REVIEW_SECTIONS, type CrowdRating, type Reviewer, type ReviewDraft, type ReviewSection, type ReviewSummary } from "@cn/core/claudeReview";
import { NO_FILTERS } from "@cn/core/feedPages";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { Checkbox } from "@cn/ui/Field";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { AdminOnly } from "../../components/AdminOnly";
import { NoteFiltersButton } from "../../components/NoteFiltersButton";
import { RouteLink } from "../../components/RouteLink";
import { PhoneSectionMenu, SidebarLayout, sidebarEntry } from "../../components/SidebarLayout";
import { parseNoteFilters } from "../../lib/feed";
import { useMomentFor } from "../../lib/feedQueries";
import type { Route } from "../../lib/routing";
import { useSettledValue } from "../../lib/useSettledValue";
import { useStoredChoice, useStoredValue } from "../../lib/useStoredValue";
import { PERSON, ReviewCard, type JudgeShown } from "./ReviewCard";
import { showNewDrafts, useLiveNotes, useNewDrafts, usePollWaitingChats, useReviewSection, useReviewSummary, type ReviewView } from "./reviewQueries";

const SECTION_TITLES: Record<ReviewSection, string> = {
  unreviewed: "Not reviewed",
  approved: "Approved",
  disapproved: "Disapproved",
  no_note: "No note",
  skipped: "Skipped",
};
const EMPTY_SECTION: Record<ReviewSection, string> = {
  unreviewed: "Every posted note has been reviewed.",
  approved: "No note has been approved yet.",
  disapproved: "No note has been disapproved.",
  no_note: "No passage ended without a note.",
  skipped: "You have not skipped any note that is still open.",
};
const RATING_LABELS: Record<CrowdRating, string> = {
  helpful: "Rated helpful",
  upvoted: "Only upvotes",
  other: "Everything else",
};
const RATING_TITLES: Record<CrowdRating, string> = {
  helpful: "Notes the crowd's votes rate helpful",
  upvoted: "Notes with Helpful or Somewhat helpful votes and no Not helpful vote",
  other: "Every other note, including notes nobody voted on",
};
/** Approved and Disapproved can be narrowed to the reviewer whose vote decided. */
const DECIDED_SECTIONS = new Set<ReviewSection>(["approved", "disapproved"]);
const DECIDED_BY = ["anyone", "jim", "nathan"] as const;
type DecidedBy = (typeof DECIDED_BY)[number];
const DECIDED_BY_OPTIONS: { id: DecidedBy; label: string }[] = [
  { id: "anyone", label: "Anyone" },
  { id: "jim", label: "Jim" },
  { id: "nathan", label: "Nathan" },
];
const DECIDED_BY_KEY = "cn:noteReviewDecidedBy";
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
/** The section whose drafts wait for a reviewer gets a highlighted count. */
const NEEDS_REVIEWER: ReviewSection = "unreviewed";

const sectionRoute = (section: ReviewSection): Route => ({ view: "noteReview", section });

function SectionList({ current, summary, navigate }: { current: ReviewSection; summary: ReviewSummary | undefined; navigate: (route: Route) => void }) {
  return (
    <nav aria-label="Sections">
      <ul className="space-y-0.5">
        {REVIEW_SECTIONS.map((section) => {
          const count = summary?.counts[section];
          const active = section === current;
          const highlighted = section === NEEDS_REVIEWER && !!count;
          return (
            <li key={section}>
              <RouteLink
                to={sectionRoute(section)}
                navigate={navigate}
                current={active}
                className={cn(sidebarEntry(active), "justify-between gap-3")}
              >
                {SECTION_TITLES[section]}
                {!!count && (
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

/** Who is reviewing and who writes the notes. */
function WhoLine({ summary }: { summary: ReviewSummary | undefined }) {
  if (!summary) return null;
  return (
    <p className="text-xs text-fg-muted">
      Reviewing as {PERSON[summary.reviewer]} · {summary.writer === "claude" ? "Claude writes the notes" : "The pipeline writes the notes"}
    </p>
  );
}

/** Which of the note judge's two guesses the cards show. */
function JudgeToggles({ judgeShown, onChange }: { judgeShown: JudgeShown; onChange: (shown: JudgeShown) => void }) {
  return (
    <fieldset className="space-y-1 text-sm text-fg-secondary">
      <legend className="mb-1 text-xs font-semibold text-fg-muted">The judge's guesses on each card</legend>
      <Checkbox checked={judgeShown.helpful} onChange={(helpful) => onChange({ ...judgeShown, helpful })} className="[@media(pointer:coarse)]:min-h-10">
        Rated helpful
      </Checkbox>
      <Checkbox checked={judgeShown.impactful} onChange={(impactful) => onChange({ ...judgeShown, impactful })} className="[@media(pointer:coarse)]:min-h-10">
        Leaderboard
      </Checkbox>
    </fieldset>
  );
}

/** The three crowd ratings a section can show. At least one stays on. */
function RatingFilter({ ratings, onChange }: { ratings: CrowdRating[]; onChange: (ratings: CrowdRating[]) => void }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-secondary">
      <legend className="float-left mr-1 text-sm font-medium text-fg">Crowd rating:</legend>
      {CROWD_RATINGS.map((rating) => (
        <span key={rating} title={RATING_TITLES[rating]}>
          <Checkbox
            checked={ratings.includes(rating)}
            disabled={ratings.length === 1 && ratings.includes(rating)}
            onChange={(on) => onChange(CROWD_RATINGS.filter((r) => (r === rating ? on : ratings.includes(r))))}
            className="[@media(pointer:coarse)]:min-h-10"
          >
            {RATING_LABELS[rating]}
          </Checkbox>
        </span>
      ))}
    </fieldset>
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
 *  on. Approved and Disapproved can be narrowed to the reviewer whose vote
 *  decided. On a phone the sidebar becomes a menu above the drafts, and the
 *  judge's checkboxes fold away. Anyone who is not an admin sees only a short message, and
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
  const [decidedBy, setDecidedBy] = useStoredChoice(DECIDED_BY_KEY, DECIDED_BY, "anyone");
  const reviewedBy: Reviewer | null = DECIDED_SECTIONS.has(section) && decidedBy !== "anyone" ? decidedBy : null;
  const votedBefore = useMomentFor(JSON.stringify([settledNoteFilters, ratings, reviewedBy]));
  const filters = useMemo(() => ({ ...settledNoteFilters, ratings, reviewedBy, votedBefore }), [settledNoteFilters, ratings, reviewedBy, votedBefore]);
  const [judgeShown, setJudgeShown] = useStoredValue(JUDGE_SHOWN_KEY, parseJudgeShown, JSON.stringify);
  const view = useMemo(() => ({ section, filters }), [section, filters]);
  const summary = useReviewSummary(filters);
  const sidebar = (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
      <div className="space-y-0.5 px-3">
        <h1 className="font-title text-lg font-bold text-fg">Note review</h1>
        <WhoLine summary={summary.data} />
      </div>
      <SectionList current={section} summary={summary.data} navigate={navigate} />
      <div className="px-3">
        <JudgeToggles judgeShown={judgeShown} onChange={setJudgeShown} />
      </div>
    </div>
  );
  return (
    <SidebarLayout storageKey="cn:noteReviewSidebarWidth" sidebar={sidebar}>
      <div className="mx-auto mb-6 max-w-[40rem] space-y-3 md:hidden">
        <div className="space-y-0.5">
          <h1 className="font-title text-2xl font-bold text-fg">Note review</h1>
          <WhoLine summary={summary.data} />
        </div>
        <PhoneSectionMenu
          sections={REVIEW_SECTIONS}
          value={section}
          titles={SECTION_TITLES}
          counts={summary.data?.counts}
          onChange={(next) => navigate(sectionRoute(next))}
        />
        <details className="text-sm text-fg-secondary">
          <summary className="cursor-pointer text-fg-muted">The judge's guesses</summary>
          <div className="mt-2">
            <JudgeToggles judgeShown={judgeShown} onChange={setJudgeShown} />
          </div>
        </details>
      </div>
      {summary.isError && <p className="mx-auto mb-4 max-w-[40rem] text-sm text-negative">{summary.error.message}</p>}
      <div className="mx-auto mb-6 max-w-[40rem] space-y-3">
        <h2 className="hidden font-title text-2xl font-bold text-fg md:block">{SECTION_TITLES[section]}</h2>
        {DECIDED_SECTIONS.has(section) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-fg">Decided by</span>
            <SegmentedControl label="Decided by" options={DECIDED_BY_OPTIONS} value={decidedBy} onChange={setDecidedBy} />
          </div>
        )}
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
