import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CURATION_SECTIONS, fetchCuratedList, fetchRemovedRecommendations, setPosition, type CuratedNoteRow, type CurationSection } from "@cn/core/bestNotes";
import type { FeedItemRow, FeedProjectRow, NnnRow, NoteRow } from "@cn/core/types";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { Checkbox } from "@cn/ui/Field";
import { ResizablePanel } from "@cn/ui/ResizablePanel";
import { FeedNoteCard } from "../../components/FeedNoteCard";
import { FiltersPopover } from "../../components/FiltersPopover";
import { ProjectAvatar } from "../../components/ProjectAvatar";
import { RouteLink } from "../../components/RouteLink";
import { entriesByClaim, improvementsByOriginal } from "../../lib/feed";
import { useCurationFeed, useProjects, type CurationRow } from "../../lib/feedQueries";
import { noteUrl, type Route } from "../../lib/routing";
import { useAdminStatus } from "../../lib/useIsAdmin";
import { useGrowingCount } from "../../lib/useGrowingCount";
import { useVotedNoteIds } from "../../lib/useVotedNoteIds";
import { BestNotesReorder } from "./BestNotesReorder";
import { CurationBar, useCurationChange } from "./CurationBar";

const NO_NOTES: NoteRow[] = [];
const NO_ENTRIES: NnnRow[] = [];
const SIDEBAR_WIDTH = { default: 280, min: 220, max: 420 };

const SECTION_TITLES: Record<CurationSection, string> = {
  recommendations: "AI recommendations",
  leaderboard: "Our leaderboard",
  removed: "Removed",
};
const SECTION_INTROS: Record<CurationSection, string> = {
  recommendations:
    "Claude's ranking of the notes a reader or the author would be most glad to have seen. Move the good ones to our leaderboard, and remove the rest with a reason.",
  leaderboard: "Our own ranking, only of notes we moved here ourselves.",
  removed: "Recommendations we removed, with the reason we gave. Restore puts a note back among the recommendations.",
};
const EMPTY_SECTION: Record<CurationSection, string> = {
  recommendations: "No recommendations are left.",
  leaderboard: "Nothing is on our leaderboard yet. Add notes from the AI recommendations.",
  removed: "No recommendation has been removed.",
};

/** One note in the open section, with what its card needs. */
interface CuratedEntry {
  row: CurationRow;
  note: NoteRow;
  post: FeedItemRow | undefined;
  project: FeedProjectRow | undefined;
}

const fetchLeaderboard = () => fetchCuratedList("leaderboard");

/** How many notes each section holds, for the sidebar. The open section shares
 *  its query, so its count changes with every move. */
function useSectionCounts(): Partial<Record<CurationSection, number>> {
  const recommendations = useQuery({ queryKey: queryKeys.curatedList("recommendations"), queryFn: () => fetchCuratedList("recommendations") });
  const leaderboard = useQuery({ queryKey: queryKeys.curatedList("leaderboard"), queryFn: fetchLeaderboard });
  const removed = useQuery({ queryKey: queryKeys.removedRecommendations, queryFn: fetchRemovedRecommendations });
  return { recommendations: recommendations.data?.length, leaderboard: leaderboard.data?.length, removed: removed.data?.length };
}

/** The creators with notes in the section, the most notes first. */
function countCreators(entries: CuratedEntry[]) {
  const counts = new Map<string, { project: FeedProjectRow; count: number }>();
  for (const { project } of entries) {
    if (project) counts.set(project.slug, { project, count: (counts.get(project.slug)?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.project.name.localeCompare(b.project.name));
}

const entryClass = (active: boolean) =>
  cn(
    "flex items-center gap-2 rounded-control px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    active ? "bg-tint font-medium text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
  );

function Sidebar({ section, projectSlug, counts, creators, navigate }: {
  section: CurationSection;
  projectSlug: string | null;
  counts: Partial<Record<CurationSection, number>>;
  creators: ReturnType<typeof countCreators>;
  navigate: (route: Route) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
      <h1 className="px-3 font-title text-lg font-bold text-fg">Best notes</h1>
      <nav aria-label="Sections">
        <ul className="space-y-0.5">
          {CURATION_SECTIONS.map((s) => (
            <li key={s}>
              <RouteLink to={{ view: "bestNotes", section: s, project: null }} navigate={navigate} current={s === section} className={entryClass(s === section)}>
                <span className="flex-1">{SECTION_TITLES[s]}</span>
                {counts[s] !== undefined && (
                  <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-xs tabular-nums text-fg-secondary">{counts[s]}</span>
                )}
              </RouteLink>
            </li>
          ))}
        </ul>
      </nav>
      {creators.length > 0 && (
        <nav aria-label="Creators">
          <h2 className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Creators</h2>
          <ul className="space-y-0.5">
            <li>
              <RouteLink to={{ view: "bestNotes", section, project: null }} navigate={navigate} current={projectSlug === null} className={entryClass(projectSlug === null)}>
                <span className="flex-1">All creators</span>
              </RouteLink>
            </li>
            {creators.map(({ project, count }) => (
              <li key={project.slug}>
                <RouteLink
                  to={{ view: "bestNotes", section, project: project.slug }}
                  navigate={navigate}
                  current={projectSlug === project.slug}
                  className={entryClass(projectSlug === project.slug)}
                >
                  <ProjectAvatar project={project} size={20} />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <span className="text-xs text-fg-muted">{count}</span>
                </RouteLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

/** The admins' curation of the best notes. Claude's recommendations come in
 *  its own ranking. Admins move the good ones to their own leaderboard, at the
 *  bottom or at a place they type, remove the rest with a reason, and comment
 *  on any note to explain its place. The leaderboard has a drag mode for
 *  reordering and a "Posted on X" mark on each note. A Filters button hides
 *  the notes already posted and the notes the admin already voted on. A sidebar switches between the sections and narrows a section
 *  to one creator, whose slug then sits in the address. Anyone who is not an
 *  admin sees only a short message, and the database refuses them both lists. */
export function BestNotesPage({ section, projectSlug, navigate }: { section: CurationSection; projectSlug: string | null; navigate: (route: Route) => void }) {
  const status = useAdminStatus();
  if (status === "loading") return <p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>;
  if (status === "not_admin") {
    return <p className="mx-auto max-w-xl px-4 py-10 text-sm text-fg-secondary">This page is for admins. Sign in with an admin account to see it.</p>;
  }
  return <CurationPage section={section} projectSlug={projectSlug} navigate={navigate} />;
}

function CurationPage({ section, projectSlug, navigate }: { section: CurationSection; projectSlug: string | null; navigate: (route: Route) => void }) {
  const projectsQuery = useProjects();
  const { list, noteSet, items, failed, retry } = useCurationFeed(section);
  const counts = useSectionCounts();
  const leaderboardQuery = useQuery({ queryKey: queryKeys.curatedList("leaderboard"), queryFn: fetchLeaderboard });
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [notPostedOnly, setNotPostedOnly] = useState(false);
  const [unvotedOnly, setUnvotedOnly] = useState(false);
  const change = useCurationChange(setError);
  // A vote cast while the filter is on keeps its card until the filter is
  // switched again, so the admin can still change the vote.
  const votedNoteIds = useVotedNoteIds(String(unvotedOnly));
  const notes = noteSet?.notes;
  const improvements = useMemo(() => improvementsByOriginal(notes?.values() ?? []), [notes]);
  const entries = useMemo(() => entriesByClaim(noteSet?.nnn.values() ?? []), [noteSet]);
  const projectsById = useMemo(() => new Map((projectsQuery.data ?? []).map((p) => [p.id, p])), [projectsQuery.data]);
  const [shownCount, setSentinel] = useGrowingCount(projectSlug ?? "");
  const leaderboard: CuratedNoteRow[] = leaderboardQuery.data ?? [];

  // A note that was deleted from the site has no row in the NoteSet and is left out.
  const curated: CuratedEntry[] = [];
  if (list && notes && items) {
    for (const row of list) {
      const note = notes.get(row.note_id);
      if (!note) continue;
      const post = items.get(note.claim.item_id);
      curated.push({ row, note, post, project: post?.project_id ? projectsById.get(post.project_id) : undefined });
    }
  }
  const shown = curated.filter(
    ({ row, project, note }) =>
      (!projectSlug || project?.slug === projectSlug) &&
      (!notPostedOnly || !("posted_at" in row && row.posted_at)) &&
      (!unvotedOnly || !votedNoteIds?.has(note.id)),
  );
  const creators = countCreators(curated);
  const selectedProject = projectsQuery.data?.find((p) => p.slug === projectSlug);

  let feed: ReactNode;
  if (failed || projectsQuery.isError || leaderboardQuery.isError) {
    feed = (
      <div className="mx-auto max-w-[40rem] space-y-3">
        <p className="text-sm text-fg-secondary">These notes could not be loaded. The connection to our server failed.</p>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  } else if (!list || !notes || !items || !projectsQuery.data || !leaderboardQuery.data) {
    feed = <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>;
  } else if (shown.length === 0) {
    feed = <p className="mx-auto max-w-[40rem] py-12 text-center text-sm text-fg-muted">{EMPTY_SECTION[section]}</p>;
  } else if (reordering) {
    feed = (
      <BestNotesReorder
        key={projectSlug}
        entries={shown.flatMap(({ row, note, project }) => ("position" in row ? [{ row, note, project }] : []))}
        list={leaderboard}
        onMove={(noteId, position) => void change(() => setPosition("leaderboard", noteId, position))}
      />
    );
  } else {
    feed = (
      <div className="space-y-6">
        {shown.slice(0, shownCount).map(({ row, note, post, project }, index) => (
          <FeedNoteCard
            key={note.id}
            note={note}
            byline={
              <CurationBar
                section={section}
                rank={index + 1}
                noteId={note.id}
                comment={"comment" in row ? row.comment : null}
                posted={"posted_at" in row && !!row.posted_at}
                removedReason={"removed_reason" in row ? row.removed_reason : null}
                project={project}
                leaderboard={leaderboard}
                navigate={navigate}
                onError={setError}
              />
            }
            post={post}
            improvements={improvements.get(note.id) ?? NO_NOTES}
            nnnEntries={entries.get(note.claim_id) ?? NO_ENTRIES}
            shareUrl={project ? noteUrl(project.slug, note.id) : window.location.href}
          />
        ))}
        {shownCount < shown.length && <div ref={setSentinel} aria-hidden="true" />}
      </div>
    );
  }

  return (
    <div className="md:flex">
      <ResizablePanel
        storageKey="cn:bestNotesSidebarWidth"
        label="sidebar"
        defaultWidth={SIDEBAR_WIDTH.default}
        minWidth={SIDEBAR_WIDTH.min}
        maxWidth={SIDEBAR_WIDTH.max}
        className="hidden bg-surface md:block md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]"
      >
        <Sidebar section={section} projectSlug={projectSlug} counts={counts} creators={creators} navigate={navigate} />
      </ResizablePanel>

      <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
        <div className="mx-auto mb-6 max-w-[40rem] space-y-3">
          <label className="block text-sm text-fg-secondary md:hidden">
            <span className="sr-only">Section</span>
            <select
              value={section}
              onChange={(e) => navigate({ view: "bestNotes", section: e.target.value as CurationSection, project: null })}
              className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-fg"
            >
              {CURATION_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {SECTION_TITLES[s]}
                  {counts[s] !== undefined ? ` (${counts[s]})` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="font-title text-2xl font-bold text-fg">
              {SECTION_TITLES[section]}
              {selectedProject && <span className="font-normal text-fg-secondary"> on {selectedProject.name}</span>}
            </h2>
            <div className="flex items-center gap-2">
              {section === "leaderboard" && shown.length > 1 && (
                <Button variant={reordering ? "primary" : "secondary"} onClick={() => setReordering(!reordering)}>
                  {reordering ? "Done" : "Reorder"}
                </Button>
              )}
              {section !== "removed" && (
                <FiltersPopover activeCount={Number(notPostedOnly) + Number(unvotedOnly)}>
                  {section === "leaderboard" && (
                    <Checkbox checked={notPostedOnly} onChange={setNotPostedOnly} className="text-sm font-medium text-fg-secondary">
                      Only notes not posted on X yet
                    </Checkbox>
                  )}
                  <Checkbox checked={unvotedOnly} onChange={setUnvotedOnly} className="text-sm font-medium text-fg-secondary">
                    Only notes I haven't voted on
                  </Checkbox>
                  <p className="text-sm text-fg-muted">{shown.length === 1 ? "1 note" : `${shown.length} notes`}</p>
                </FiltersPopover>
              )}
            </div>
          </div>
          <p className="text-sm text-fg-muted">{SECTION_INTROS[section]}</p>
          {error && <p className="text-sm text-negative">{error}</p>}
        </div>
        {feed}
      </main>
    </div>
  );
}
