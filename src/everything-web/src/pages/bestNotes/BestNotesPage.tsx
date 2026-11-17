import { useCallback, useState, type ReactNode } from "react";
import { setPosition, type CurationCreator } from "@cn/core/bestNotes";
import { Button } from "@cn/ui/Button";
import { Checkbox } from "@cn/ui/Field";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { AdminOnly } from "../../components/AdminOnly";
import { FiltersPopover } from "../../components/FiltersPopover";
import { NoteFeed, type FeedCard } from "../../components/NoteFeed";
import { ProjectAvatar } from "../../components/ProjectAvatar";
import { RouteLink } from "../../components/RouteLink";
import { SidebarLayout, sidebarEntry } from "../../components/SidebarLayout";
import { useCurationSummary, useLeaderboardPages, useWholeLeaderboard, type CurationEntry } from "../../lib/feedQueries";
import type { Route } from "../../lib/routing";
import { BestNotesReorder } from "./BestNotesReorder";
import { CurationBar, useCurationChange } from "./CurationBar";

function Sidebar({ projectSlug, count, creators, navigate }: {
  projectSlug: string | null;
  count: number | undefined;
  creators: CurationCreator[];
  navigate: (route: Route) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
      <h1 className="px-3 font-title text-lg font-bold text-fg">Best notes</h1>
      <nav aria-label="Creators">
        <ul className="space-y-0.5">
          <li>
            <RouteLink to={{ view: "bestNotes", project: null }} navigate={navigate} current={projectSlug === null} className={sidebarEntry(projectSlug === null)}>
              <span className="flex-1">All creators</span>
              {count !== undefined && <span className="text-xs text-fg-muted">{count}</span>}
            </RouteLink>
          </li>
          {creators.map((project) => (
            <li key={project.slug}>
              <RouteLink to={{ view: "bestNotes", project: project.slug }} navigate={navigate} current={projectSlug === project.slug} className={sidebarEntry(projectSlug === project.slug)}>
                <ProjectAvatar project={project} size={20} />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="text-xs text-fg-muted">{project.count}</span>
              </RouteLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** The admins' leaderboard of the best notes. Admins add notes to it from the
 *  review page, at the bottom, and comment on any note to explain its place.
 *  It loads a page at a time as the admin scrolls, and a drag mode for
 *  reordering loads the whole list. Each note has a "Posted on X" mark. A
 *  Filters button hides the notes already posted and the notes the admin
 *  already voted on. A sidebar narrows the list to one creator, whose slug
 *  then sits in the address. Anyone who is not an admin sees only a short
 *  message, and the database refuses them the list. */
export function BestNotesPage({ projectSlug, navigate }: { projectSlug: string | null; navigate: (route: Route) => void }) {
  return (
    <AdminOnly>
      <Leaderboard projectSlug={projectSlug} navigate={navigate} />
    </AdminOnly>
  );
}

function Leaderboard({ projectSlug, navigate }: { projectSlug: string | null; navigate: (route: Route) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [notPostedOnly, setNotPostedOnly] = useState(false);
  const [unvotedOnly, setUnvotedOnly] = useState(false);
  const change = useCurationChange(setError);
  const summary = useCurationSummary();
  const list = useLeaderboardPages({ projectSlug, notPostedOnly, unvotedOnly });
  const wholeLeaderboard = useWholeLeaderboard(reordering);
  const creators = summary.data?.creators ?? [];
  const selectedProject = creators.find((p) => p.slug === projectSlug);
  const byline = useCallback(
    ({ entry: { row }, note, project }: FeedCard<CurationEntry>, index: number) => (
      <CurationBar rank={index + 1} noteId={note.id} comment={row.comment} posted={!!row.posted_at} project={project} navigate={navigate} onError={setError} />
    ),
    [navigate],
  );

  let feed: ReactNode;
  if (reordering) {
    const whole = wholeLeaderboard.data;
    if (wholeLeaderboard.isError) feed = <LoadFailed what="The leaderboard" onRetry={() => void wholeLeaderboard.refetch()} className="mx-auto max-w-[40rem]" />;
    else if (!whole) feed = <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>;
    else {
      // In a list narrowed to one creator, only that creator's notes are
      // dragged, and the notes of other creators keep their places.
      const entries = whole.entries.flatMap(({ row }) => {
        const note = whole.notes.get(row.note_id);
        const post = note && whole.items.get(note.claim.item_id);
        const project = post?.project_id ? whole.projects.get(post.project_id) : undefined;
        return note && (!projectSlug || project?.slug === projectSlug) ? [{ row, note, project }] : [];
      });
      feed = (
        <BestNotesReorder
          key={projectSlug}
          entries={entries}
          list={whole.entries.map(({ row }) => row)}
          onMove={(noteId, position) => void change(() => setPosition(noteId, position))}
        />
      );
    }
  } else {
    feed = <NoteFeed list={list} byline={byline} emptyText="Nothing is on our leaderboard yet. Add notes from the note review page." />;
  }

  return (
    <SidebarLayout
      storageKey="cn:bestNotesSidebarWidth"
      sidebar={<Sidebar projectSlug={projectSlug} count={summary.data?.count} creators={creators} navigate={navigate} />}
    >
      <div className="mx-auto mb-6 max-w-[40rem] space-y-3">
        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="font-title text-2xl font-bold text-fg">
            Our leaderboard
            {selectedProject && <span className="font-normal text-fg-secondary"> on {selectedProject.name}</span>}
          </h2>
          <div className="flex items-center gap-2">
            {(summary.data?.count ?? 0) > 1 && (
              <Button variant={reordering ? "primary" : "secondary"} onClick={() => setReordering(!reordering)}>
                {reordering ? "Done" : "Reorder"}
              </Button>
            )}
            <FiltersPopover activeCount={Number(notPostedOnly) + Number(unvotedOnly)}>
              <Checkbox checked={notPostedOnly} onChange={setNotPostedOnly} className="text-sm font-medium text-fg-secondary">
                Only notes not posted on X yet
              </Checkbox>
              <Checkbox checked={unvotedOnly} onChange={setUnvotedOnly} className="text-sm font-medium text-fg-secondary">
                Only notes I haven't voted on
              </Checkbox>
            </FiltersPopover>
          </div>
        </div>
        {error && <p className="text-sm text-negative">{error}</p>}
      </div>
      {feed}
    </SidebarLayout>
  );
}
