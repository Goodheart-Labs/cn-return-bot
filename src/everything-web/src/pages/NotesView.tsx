import { LoadFailed } from "@cn/features/query/LoadFailed";
import { useProject } from "../lib/feedQueries";
import type { Route } from "../lib/routing";
import { AllNotesPage } from "./AllNotesPage";
import { LeaderboardPage } from "./LeaderboardPage";
import { ProjectPage } from "./ProjectPage";
import { ProjectsPage } from "./ProjectsPage";

type NotesRoute = Extract<Route, { view: "notes" | "allNotes" | "leaderboard" }>;
type ProjectRoute = Extract<Route, { view: "notes" }>;

/** One project's page, once the project its link names has loaded. A link
 *  that names no project we know shows the overview, which beats an empty
 *  page. */
function ProjectRoutePage({ route, navigate }: { route: ProjectRoute & { project: string }; navigate: (next: Route) => void }) {
  const projectQuery = useProject(route.project);
  if (projectQuery.isError) return <LoadFailed what="This project" onRetry={() => void projectQuery.refetch()} className="px-8 py-10" />;
  if (projectQuery.data === undefined) return <p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>;
  if (projectQuery.data === null) return <ProjectsPage navigate={navigate} />;
  const project = projectQuery.data;
  return <ProjectPage key={project.id} project={project} itemId={route.item} noteId={route.note} navigate={navigate} />;
}

/** The notes part of the website: the overview of all projects, every note
 *  in one feed, one project's notes, or the rating leaderboard. */
export function NotesView({ route, navigate }: { route: NotesRoute; navigate: (next: Route) => void }) {
  if (route.view === "leaderboard") {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="mb-2 font-title text-3xl font-bold text-fg">Rating leaderboard</h1>
        <LeaderboardPage />
      </main>
    );
  }
  if (route.view === "allNotes") return <AllNotesPage navigate={navigate} />;
  if (!route.project) return <ProjectsPage navigate={navigate} />;
  return <ProjectRoutePage route={{ ...route, project: route.project }} navigate={navigate} />;
}
