import { useState, type ReactNode } from "react";
import { CURATION_SECTIONS, setPosition, type CurationCreator, type CurationSection } from "@cn/core/bestNotes";
import { cn } from "@cn/ui/cn";
import { Button } from "@cn/ui/Button";
import { Checkbox } from "@cn/ui/Field";
import { ResizablePanel } from "@cn/ui/ResizablePanel";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { FiltersPopover } from "../../components/FiltersPopover";
import { NoteFeed } from "../../components/NoteFeed";
import { ProjectAvatar } from "../../components/ProjectAvatar";
import { RouteLink } from "../../components/RouteLink";
import { useCurationSection, useCurationSummary, useWholeLeaderboard } from "../../lib/feedQueries";
import { noteUrl, type Route } from "../../lib/routing";
import { useAdminStatus } from "../../lib/useIsAdmin";
import { BestNotesReorder } from "./BestNotesReorder";
import { CurationBar, useCurationChange } from "./CurationBar";

const SIDEBAR_WIDTH = { default: 280, min: 220, max: 420 };

const SECTION_TITLES: Record<CurationSection, string> = {
  recommendations: "AI recommendations",
  leaderboard: "Our leaderboard",
  removed: "Removed",
};
const EMPTY_SECTION: Record<CurationSection, string> = {
  recommendations: "No recommendations are left.",
  leaderboard: "Nothing is on our leaderboard yet. Add notes from the AI recommendations.",
  removed: "No recommendation has been removed.",
};

const entryClass = (active: boolean) =>
  cn(
    "flex items-center gap-2 rounded-control px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    active ? "bg-tint font-medium text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
  );

function Sidebar({ section, projectSlug, counts, creators, navigate }: {
  section: CurationSection;
  projectSlug: string | null;
  counts: Partial<Record<CurationSection, number>>;
  creators: CurationCreator[];
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
            {creators.map((project) => (
              <li key={project.slug}>
                <RouteLink
                  to={{ view: "bestNotes", section, project: project.slug }}
                  navigate={navigate}
                  current={projectSlug === project.slug}
                  className={entryClass(projectSlug === project.slug)}
                >
                  <ProjectAvatar project={project} size={20} />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <span className="text-xs text-fg-muted">{project.count}</span>
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
 *  on any note to explain its place. Each section loads a page at a time as
 *  the admin scrolls. The leaderboard has a drag mode for reordering, which
 *  loads the whole leaderboard, and a "Posted on X" mark on each note. A
 *  Filters button hides the notes already posted and the notes the admin
 *  already voted on. A sidebar switches between the sections and narrows a
 *  section to one creator, whose slug then sits in the address. Anyone who is not an
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
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [notPostedOnly, setNotPostedOnly] = useState(false);
  const [unvotedOnly, setUnvotedOnly] = useState(false);
  const change = useCurationChange(setError);
  const summary = useCurationSummary(section);
  const list = useCurationSection(section, { projectSlug, notPostedOnly: section === "leaderboard" && notPostedOnly, unvotedOnly: section !== "removed" && unvotedOnly });
  const wholeLeaderboard = useWholeLeaderboard(reordering);
  const counts: Partial<Record<CurationSection, number>> = summary.data?.counts ?? {};
  const creators = summary.data?.creators ?? [];
  const selectedProject = creators.find((p) => p.slug === projectSlug);

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
          onMove={(noteId, position) => void change(() => setPosition("leaderboard", noteId, position))}
        />
      );
    }
  } else {
    feed = (
      <NoteFeed
        list={list}
        byline={({ entry: { row }, note, project }, index) => (
          <CurationBar
            section={section}
            rank={index + 1}
            noteId={note.id}
            comment={row.comment}
            posted={!!row.posted_at}
            removedReason={row.removed_reason}
            project={project}
            leaderboardSize={counts.leaderboard ?? 0}
            navigate={navigate}
            onError={setError}
          />
        )}
        shareUrl={({ note, project }) => (project ? noteUrl(project.slug, note.id) : window.location.href)}
        emptyText={EMPTY_SECTION[section]}
      />
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
              {section === "leaderboard" && (counts.leaderboard ?? 0) > 1 && (
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
                </FiltersPopover>
              )}
            </div>
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
        </div>
        {feed}
      </main>
    </div>
  );
}
