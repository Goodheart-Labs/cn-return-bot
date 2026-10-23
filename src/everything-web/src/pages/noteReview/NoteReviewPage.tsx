import { useMutation, useQueryClient } from "@tanstack/react-query";
import { REVIEW_SECTIONS, setApprovalRequired, type ReviewDraft, type ReviewSection, type ReviewSummary } from "@cn/core/claudeReview";
import { queryKeys } from "@cn/features/query/queryKeys";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { ResizablePanel } from "@cn/ui/ResizablePanel";
import { RouteLink } from "../../components/RouteLink";
import type { Route } from "../../lib/routing";
import { useAdminStatus } from "../../lib/useIsAdmin";
import { PERSON, ReviewCard } from "./ReviewCard";
import { showNewDrafts, useLiveNotes, useNewDrafts, usePollWaitingChats, useReviewSection, useReviewSummary } from "./reviewQueries";

const SECTION_TITLES: Record<ReviewSection, string> = {
  unreviewed: "Posted, not reviewed",
  waiting: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  no_note: "No note",
};
const EMPTY_SECTION: Record<ReviewSection, string> = {
  unreviewed: "Every posted note has been reviewed.",
  waiting: "No note is waiting for approval.",
  approved: "No note has been approved yet.",
  rejected: "No note has been rejected.",
  no_note: "No passage ended without a note.",
};
/** Sections whose drafts wait for a reviewer get a highlighted count. */
const NEEDS_REVIEWER = new Set<ReviewSection>(["unreviewed", "waiting"]);

/** How wide the sidebar starts, and how far it can be dragged. */
const SIDEBAR_WIDTH = { default: 280, min: 220, max: 420 };

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
                className={cn(
                  "flex items-center justify-between gap-3 rounded-control px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  active ? "bg-tint font-medium text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
                )}
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
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.noteReviewSummary }),
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

/** Who is reviewing, who writes the notes, and the approval switch. */
function Settings({ summary }: { summary: ReviewSummary | undefined }) {
  if (!summary) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      <span>Reviewing as {PERSON[summary.reviewer]}</span>
      <span className="rounded-full border border-line px-2 py-0.5">{summary.writer === "claude" ? "Claude writes" : "Pipeline writes"}</span>
      <ApprovalSwitch approvalRequired={summary.approvalRequired} />
    </div>
  );
}

/** One loaded page of drafts. Each page reads the live notes of its own
 *  drafts, so loading the next page never reloads the notes above it. */
function DraftPage({ drafts, section }: { drafts: ReviewDraft[]; section: ReviewSection }) {
  const liveNotes = useLiveNotes(drafts);
  return drafts.map((draft) => (
    <ReviewCard key={draft.id} draft={draft} liveNote={draft.noteId ? liveNotes?.get(draft.noteId) : undefined} section={section} />
  ));
}

function SectionFeed({ section }: { section: ReviewSection }) {
  const client = useQueryClient();
  const list = useReviewSection(section);
  const pages = list.pages;
  const drafts = pages?.flat();
  const newDrafts = useNewDrafts(section, drafts);
  usePollWaitingChats(section, drafts ?? []);

  if (list.failed) return <LoadFailed what="These drafts" onRetry={list.retry} className="mx-auto max-w-[40rem]" />;
  if (!pages || !drafts) return <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>;
  return (
    <div className="space-y-6">
      {newDrafts.length > 0 && (
        <div className="mx-auto max-w-[40rem]">
          <Button variant="secondary" className="w-full" onClick={() => showNewDrafts(client, section, newDrafts)}>
            {newDrafts.length === 1 ? "1 new draft. Show it" : `${newDrafts.length} new drafts. Show them`}
          </Button>
        </div>
      )}
      {drafts.length === 0 && <p className="mx-auto max-w-[40rem] py-12 text-center text-sm text-fg-muted">{EMPTY_SECTION[section]}</p>}
      {pages.map((page, index) => (
        <DraftPage key={index} drafts={page} section={section} />
      ))}
      {drafts.length > 0 && <PagedListEnd list={list} endText="That is every draft in this section." className="mx-auto max-w-[40rem]" />}
    </div>
  );
}

/** The admins' review of the Claude note writer's notes. A sidebar lists the
 *  sections with their counts, and the open section's drafts load page by
 *  page as the admin scrolls. On a phone the sidebar becomes a menu above the
 *  drafts. Anyone who is not an admin sees only a short message, and the
 *  database refuses them every draft and every step. */
export function NoteReviewPage({ section, navigate }: { section: ReviewSection; navigate: (route: Route) => void }) {
  const status = useAdminStatus();
  const summary = useReviewSummary(status === "admin");
  if (status === "loading") return <p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>;
  if (status === "not_admin") {
    return <p className="mx-auto max-w-xl px-4 py-10 text-sm text-fg-secondary">This page is for admins. Sign in with an admin account to see it.</p>;
  }
  return (
    <div className="md:flex">
      <ResizablePanel
        storageKey="cn:noteReviewSidebarWidth"
        label="sidebar"
        defaultWidth={SIDEBAR_WIDTH.default}
        minWidth={SIDEBAR_WIDTH.min}
        maxWidth={SIDEBAR_WIDTH.max}
        className="hidden bg-surface md:block md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]"
      >
        <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
          <h1 className="px-3 font-title text-lg font-bold text-fg">Note review</h1>
          <SectionList current={section} summary={summary.data} navigate={navigate} />
          <div className="mt-auto px-3">
            <Settings summary={summary.data} />
          </div>
        </div>
      </ResizablePanel>

      <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
        <div className="mx-auto mb-6 max-w-[40rem] space-y-3 md:hidden">
          <h1 className="font-title text-2xl font-bold text-fg">Note review</h1>
          <label className="block text-sm text-fg-secondary">
            <span className="sr-only">Section</span>
            <select
              value={section}
              onChange={(e) => navigate(sectionRoute(e.target.value as ReviewSection))}
              className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-fg"
            >
              {REVIEW_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {SECTION_TITLES[s]}
                  {summary.data ? ` (${summary.data.counts[s]})` : ""}
                </option>
              ))}
            </select>
          </label>
          <Settings summary={summary.data} />
        </div>
        {summary.isError && <p className="mx-auto mb-4 max-w-[40rem] text-sm text-negative">{summary.error.message}</p>}
        <h2 className="mx-auto mb-6 hidden max-w-[40rem] font-title text-2xl font-bold text-fg md:block">{SECTION_TITLES[section]}</h2>
        <SectionFeed key={section} section={section} />
      </main>
    </div>
  );
}
