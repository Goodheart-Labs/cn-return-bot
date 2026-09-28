import { useState } from "react";
import { track } from "@cn/core/analytics";
import type { FeedProjectRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { ExtensionCornerLink } from "../components/ExtensionCornerLink";
import { Sidebar } from "../components/Sidebar";
import { WriteNoteModal } from "../components/WriteNoteModal";
import { useProjects } from "../lib/feedQueries";
import type { Route } from "../lib/routing";
import { FeedPage } from "./FeedPage";
import { LeaderboardPage } from "./LeaderboardPage";

const NO_PROJECTS: FeedProjectRow[] = [];

type NotesRoute = Extract<Route, { view: "notes" | "leaderboard" }>;

/** The notes part of the website: the project list on the side, and the feed
 *  or the leaderboard beside it. */
export function NotesView({ route, navigate }: { route: NotesRoute; navigate: (next: Route) => void }) {
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? NO_PROJECTS;
  const [writeOpen, setWriteOpen] = useState(false);

  // Without a project in the URL the feed opens on the first project in the
  // list, which is the most voted project that has content.
  const project = route.view === "notes" ? (projects.find((p) => p.slug === route.project) ?? projects[0] ?? null) : null;

  let page;
  if (route.view === "leaderboard") page = <LeaderboardPage />;
  else if (projectsQuery.isError) {
    page = (
      <div className="space-y-3">
        <p className="text-sm text-fg-secondary">These notes could not be loaded. The connection to our server failed.</p>
        <Button onClick={() => void projectsQuery.refetch()}>Try again</Button>
      </div>
    );
  } else if (project) {
    page = (
      <FeedPage
        key={project.id}
        project={project}
        itemId={route.item}
        noteId={route.note}
        onSelectItem={(item) => navigate({ view: "notes", project: project.slug, item, note: null })}
      />
    );
  } else page = <p className="text-sm text-fg-muted">Loading…</p>;

  return (
    <div className="md:flex">
      <Sidebar
        projects={projects}
        selectedId={project?.id ?? null}
        onSelect={(slug) => navigate({ view: "notes", project: slug, item: null, note: null })}
        leaderboardSelected={route.view === "leaderboard"}
        onSelectLeaderboard={() => navigate({ view: "leaderboard" })}
      />

      {/* min-w-0 is what keeps the feed inside the window. A flex item starts
        * with min-width auto, which means it refuses to shrink below its own
        * content. This main element also sets w-full, so that floor is the
        * full width of the window, and the sidebar then pushes the feed off
        * the right edge. Setting the floor to zero lets the feed take the
        * space that is actually left beside the sidebar. */}
      <main className="flex-1 min-w-0 max-w-3xl md:max-w-[96rem] mx-auto px-4 md:px-8 py-8 w-full">
        {/* The title and the action share one row on a wide window. On a
          * phone they do not fit next to each other, so the row may wrap and
          * the title may break rather than push the action off screen. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-6">
          <h1 className="text-2xl font-extrabold min-w-0 break-words">
            {route.view === "leaderboard" ? "Rating leaderboard" : project?.name}
          </h1>
          <Button
            variant="link"
            className="text-sm font-medium shrink-0"
            onClick={() => {
              setWriteOpen(true);
              // The modal is a "get the extension" teaser. Each open is a
              // reader asking for a write flow, which is extension demand.
              track("write_note_teaser_shown");
            }}
          >
            Write a note
          </Button>
        </div>
        {page}
      </main>

      <ExtensionCornerLink />
      <WriteNoteModal open={writeOpen} onClose={() => setWriteOpen(false)} />
    </div>
  );
}
