import type { FeedProjectRow } from "@cn/core/types";
import { useProjects } from "../lib/feedQueries";
import type { Route } from "../lib/routing";
import { LeaderboardPage } from "./LeaderboardPage";
import { ProjectPage } from "./ProjectPage";
import { ProjectsPage } from "./ProjectsPage";

const NO_PROJECTS: FeedProjectRow[] = [];

type NotesRoute = Extract<Route, { view: "notes" | "leaderboard" }>;

/** The notes part of the website: the overview of all projects, one
 *  project's notes, or the rating leaderboard. */
export function NotesView({ route, navigate }: { route: NotesRoute; navigate: (next: Route) => void }) {
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? NO_PROJECTS;

  if (route.view === "leaderboard") {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="mb-2 font-title text-3xl font-bold text-fg">Rating leaderboard</h1>
        <LeaderboardPage />
      </main>
    );
  }
  if (!route.project) return <ProjectsPage navigate={navigate} />;

  const project = projects.find((p) => p.slug === route.project);
  // A project link that names no project we know shows the overview, which
  // beats an empty page. Until the list has loaded there is nothing to decide.
  if (!project) return projectsQuery.isPending ? <p className="px-8 py-10 text-sm text-fg-muted">Loading…</p> : <ProjectsPage navigate={navigate} />;
  return <ProjectPage key={project.id} project={project} itemId={route.item} noteId={route.note} navigate={navigate} />;
}
