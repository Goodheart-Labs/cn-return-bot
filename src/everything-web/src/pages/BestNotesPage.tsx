import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { moveBestNote, positionBetween, removeBestNote, type BestNoteRow } from "@cn/core/bestNotes";
import type { FeedItemRow, FeedProjectRow, NnnRow, NoteRow } from "@cn/core/types";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { IconButton } from "@cn/ui/IconButton";
import { ArrowDownIcon, ArrowUpIcon, ToTopIcon, TrashIcon, TrophyIcon } from "@cn/ui/icons";
import { ResizablePanel } from "@cn/ui/ResizablePanel";
import { BackToProjects } from "../components/BackToProjects";
import { FeedNoteCard } from "../components/FeedNoteCard";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { RouteLink } from "../components/RouteLink";
import { entriesByClaim, improvementsByOriginal } from "../lib/feed";
import { useBestNotesFeed, useProjects } from "../lib/feedQueries";
import { noteUrl, type Route } from "../lib/routing";
import { useGrowingCount } from "../lib/useGrowingCount";
import { useIsAdmin } from "../lib/useIsAdmin";

const NO_NOTES: NoteRow[] = [];
const NO_ENTRIES: NnnRow[] = [];
const CREATOR_LIST_WIDTH = { default: 260, min: 200, max: 420 };

const noteCount = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;

/** One note on the list, with what its card needs. */
interface BestNote {
  row: BestNoteRow;
  note: NoteRow;
  post: FeedItemRow | undefined;
  project: FeedProjectRow | undefined;
}

/** One creator with notes on the list, and how many. */
interface CreatorCount {
  project: FeedProjectRow;
  count: number;
}

/** The creators with notes on the list, the most notes first. */
function countCreators(notes: BestNote[]): CreatorCount[] {
  const counts = new Map<string, CreatorCount>();
  for (const { project } of notes) {
    if (project) counts.set(project.slug, { project, count: (counts.get(project.slug)?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.project.name.localeCompare(b.project.name));
}

/** The sidebar: "All creators" on top, then each creator with notes on the
 *  list. Each entry links to the list narrowed to that creator, so the
 *  narrowed list can be shared. */
function CreatorList({ creators, total, selected, navigate }: {
  creators: CreatorCount[];
  total: number;
  selected: string | null;
  navigate: (route: Route) => void;
}) {
  const entryClass = (active: boolean) =>
    cn(
      "flex items-center gap-2 rounded-control px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
      active ? "bg-tint text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
    );
  return (
    <nav aria-label="Creators">
      <ul className="space-y-0.5">
        <li>
          <RouteLink to={{ view: "bestNotes", project: null }} navigate={navigate} current={selected === null} className={entryClass(selected === null)}>
            <span className="flex-1 font-semibold">All creators</span>
            <span className="text-xs text-fg-muted">{noteCount(total)}</span>
          </RouteLink>
        </li>
        {creators.map(({ project, count }) => (
            <li key={project.slug}>
              <RouteLink
                to={{ view: "bestNotes", project: project.slug }}
                navigate={navigate}
                current={selected === project.slug}
                className={entryClass(selected === project.slug)}
              >
                <ProjectAvatar project={project} size={20} />
                <span className={cn("min-w-0 flex-1 truncate text-sm", selected === project.slug && "font-medium")}>{project.name}</span>
                <span className="text-xs text-fg-muted">{count}</span>
              </RouteLink>
            </li>
          ))}
      </ul>
    </nav>
  );
}

/** The admin's buttons on a card: move to the top, move up, move down, and
 *  take the note off the list. The neighbours are the notes on screen, so in a
 *  list narrowed to one creator a note moves past that creator's neighbouring
 *  note. */
function AdminControls({ noteId, first, previous, next, list, onError }: {
  noteId: string;
  first: BestNoteRow | undefined;
  previous: BestNoteRow | undefined;
  next: BestNoteRow | undefined;
  list: BestNoteRow[];
  onError: (message: string) => void;
}) {
  const client = useQueryClient();
  const neighbourPosition = (target: BestNoteRow, offset: number) => list[list.findIndex((row) => row.note_id === target.note_id) + offset]?.position;
  /** Changes the cached list at once, so the card jumps without waiting for
   *  the server, and loads the list again if the server refused. */
  const change = (update: (rows: BestNoteRow[]) => BestNoteRow[], write: () => Promise<void>) => {
    client.setQueryData<BestNoteRow[]>(queryKeys.bestNotes, (rows) => rows && update(rows));
    write().catch((err: Error) => {
      onError(err.message);
      void client.invalidateQueries({ queryKey: queryKeys.bestNotes });
    });
  };
  const moveTo = (position: number) =>
    change(
      (rows) => rows.map((row) => (row.note_id === noteId ? { ...row, position } : row)).sort((a, b) => a.position - b.position),
      () => moveBestNote(noteId, position),
    );
  const moveBefore = (target: BestNoteRow) => moveTo(positionBetween(neighbourPosition(target, -1), target.position));
  const moveAfter = (target: BestNoteRow) => moveTo(positionBetween(target.position, neighbourPosition(target, 1)));
  const remove = () => {
    if (!window.confirm("Take this note off the best notes list? The note stays on the site.")) return;
    change((rows) => rows.filter((row) => row.note_id !== noteId), () => removeBestNote(noteId));
  };
  return (
    <span className="ml-auto flex items-center gap-0.5">
      {first && previous && (
        <>
          <IconButton label="Move to the top" onClick={() => moveBefore(first)}>
            <ToTopIcon size={15} aria-hidden />
          </IconButton>
          <IconButton label="Move up" onClick={() => moveBefore(previous)}>
            <ArrowUpIcon size={15} aria-hidden />
          </IconButton>
        </>
      )}
      {next && (
        <IconButton label="Move down" onClick={() => moveAfter(next)}>
          <ArrowDownIcon size={15} aria-hidden />
        </IconButton>
      )}
      <IconButton label="Take off the list" onClick={remove}>
        <TrashIcon size={15} aria-hidden />
      </IconButton>
    </span>
  );
}

/** The line at the top of each card: the note's rank, its creator, and for
 *  admins the buttons that reorder the list. */
function Byline({ rank, project, controls, navigate }: { rank: number; project: FeedProjectRow | undefined; controls: ReactNode; navigate: (route: Route) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-title text-base font-bold text-fg-secondary">#{rank}</span>
      {project && (
        <RouteLink
          to={{ view: "notes", project: project.slug, item: null, note: null }}
          navigate={navigate}
          className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary hover:text-fg"
        >
          <ProjectAvatar project={project} size={22} />
          {project.name}
        </RouteLink>
      )}
      {controls}
    </div>
  );
}

/** The best notes, in the order the team ranked them: the notes a reader or
 *  the author would be most glad to have seen. A sidebar narrows the list to
 *  one creator, whose slug then sits in the address. Admins reorder the list
 *  and take notes off it from each card. */
export function BestNotesPage({ projectSlug, navigate }: { projectSlug: string | null; navigate: (route: Route) => void }) {
  const projectsQuery = useProjects();
  const { list, noteSet, items, failed, retry } = useBestNotesFeed();
  const admin = useIsAdmin();
  const [error, setError] = useState<string | null>(null);
  const notes = noteSet?.notes;
  const improvements = useMemo(() => improvementsByOriginal(notes?.values() ?? []), [notes]);
  const entries = useMemo(() => entriesByClaim(noteSet?.nnn.values() ?? []), [noteSet]);
  const projectsById = useMemo(() => new Map((projectsQuery.data ?? []).map((p) => [p.id, p])), [projectsQuery.data]);

  // A note on the list that is hidden or deleted has no row in the NoteSet and
  // is left out.
  const ranked: BestNote[] = [];
  if (list && notes && items) {
    for (const row of list) {
      const note = notes.get(row.note_id);
      if (!note) continue;
      const post = items.get(note.claim.item_id);
      ranked.push({ row, note, post, project: post?.project_id ? projectsById.get(post.project_id) : undefined });
    }
  }
  const shown = projectSlug ? ranked.filter((entry) => entry.project?.slug === projectSlug) : ranked;
  const creators = countCreators(ranked);
  const [shownCount, setSentinel] = useGrowingCount(projectSlug ?? "");
  const selectedProject = projectsQuery.data?.find((p) => p.slug === projectSlug);

  let feed: ReactNode;
  if (failed || projectsQuery.isError) {
    feed = (
      <div className="space-y-3">
        <p className="text-sm text-fg-secondary">These notes could not be loaded. The connection to our server failed.</p>
        <Button
          onClick={() => {
            retry();
            void projectsQuery.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  } else if (!list || !notes || !items || !projectsQuery.data) {
    feed = <p className="text-sm text-fg-muted">Loading…</p>;
  } else if (shown.length === 0) {
    feed = <p className="text-sm text-fg-secondary">No notes from this creator are on the list yet.</p>;
  } else {
    feed = (
      <div className="space-y-6">
        {shown.slice(0, shownCount).map(({ note, post, project }, index) => (
          <FeedNoteCard
            key={note.id}
            note={note}
            byline={
              <Byline
                rank={index + 1}
                project={project}
                navigate={navigate}
                controls={
                  admin && (
                    <AdminControls
                      noteId={note.id}
                      first={shown[0]?.row}
                      previous={shown[index - 1]?.row}
                      next={shown[index + 1]?.row}
                      list={list}
                      onError={setError}
                    />
                  )
                }
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
        storageKey="cn:bestCreatorListWidth"
        label="list of creators"
        defaultWidth={CREATOR_LIST_WIDTH.default}
        minWidth={CREATOR_LIST_WIDTH.min}
        maxWidth={CREATOR_LIST_WIDTH.max}
        className="hidden bg-surface md:block md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]"
      >
        <div className="h-full space-y-5 overflow-y-auto px-3 py-5">
          <div className="px-3">
            <BackToProjects navigate={navigate} />
          </div>
          <CreatorList creators={creators} total={ranked.length} selected={projectSlug} navigate={navigate} />
        </div>
      </ResizablePanel>

      <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
        <div className="mx-auto mb-6 max-w-[40rem] space-y-3">
          <div className="md:hidden">
            <BackToProjects navigate={navigate} />
          </div>
          <h1 className="flex items-center gap-2 font-title text-2xl font-bold text-fg">
            <TrophyIcon size={24} aria-hidden className="text-fg-secondary" />
            Best notes{selectedProject && <span className="font-normal text-fg-secondary">on {selectedProject.name}</span>}
          </h1>
          <p className="text-base text-fg-muted">The notes we are proudest of: the ones a reader, or the author, would be most glad to have seen.</p>
          {ranked.length > 0 && (
            <label className="block text-sm text-fg-secondary md:hidden">
              <span className="sr-only">Creator</span>
              <select
                value={projectSlug ?? ""}
                onChange={(e) => navigate({ view: "bestNotes", project: e.target.value || null })}
                className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-fg"
              >
                <option value="">All creators ({ranked.length})</option>
                {creators.map(({ project, count }) => (
                  <option key={project.slug} value={project.slug}>
                    {project.name} ({count})
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="text-sm text-negative">{error}</p>}
        </div>
        {feed}
      </main>
    </div>
  );
}
