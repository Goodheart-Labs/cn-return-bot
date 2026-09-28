import { useState } from "react";
import { track } from "@cn/core/analytics";
import type { FeedProjectRow } from "@cn/core/types";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import { BUTTON, LINK } from "@cn/ui/classes";
import { AuthCorner } from "./components/AuthCorner";
import { ExtensionCornerLink } from "./components/ExtensionCornerLink";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { LoginModal } from "./components/LoginModal";
import { Sidebar } from "./components/Sidebar";
import { SystemTheme } from "./components/SystemTheme";
import { WriteNoteModal } from "./components/WriteNoteModal";
import { useProjects } from "./lib/feedQueries";
import { useRoute } from "./lib/routing";
import { useAuthAnalytics } from "./lib/useAuthAnalytics";
import { FeedPage } from "./pages/FeedPage";

const NO_PROJECTS: FeedProjectRow[] = [];

/** The website's frame: the sidebar, the header row, and the page the route
 *  names. */
export function App() {
  const [route, navigate] = useRoute();
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? NO_PROJECTS;
  const [loginOpen, setLoginOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  useAuthAnalytics();

  // Without a project in the URL the feed opens on the first project in the
  // list, which is the most voted project that has content.
  const project = route.view === "notes" ? (projects.find((p) => p.slug === route.project) ?? projects[0] ?? null) : null;

  let page;
  if (route.view === "leaderboard") page = <LeaderboardPage />;
  else if (projectsQuery.isError) {
    page = (
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">These notes could not be loaded. The connection to our server failed.</p>
        <button onClick={() => void projectsQuery.refetch()} className={BUTTON}>Try again</button>
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
  } else page = <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>;

  return (
    <LoginPromptProvider value={() => setLoginOpen(true)}>
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
          {/* The title and the two actions share one row on a wide window. On a
            * phone they do not fit next to each other, so the row may wrap and
            * the title may break rather than push the actions off screen. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-6">
            <h2 className="text-2xl font-extrabold min-w-0 break-words">
              {route.view === "leaderboard" ? "Rating leaderboard" : project?.name}
            </h2>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setWriteOpen(true);
                  // The modal is a "get the extension" teaser. Each open is a
                  // reader asking for a write flow, which is extension demand.
                  track("write_note_teaser_shown");
                }}
                className={`text-sm font-medium shrink-0 ${LINK}`}
              >
                Write a note
              </button>
              <AuthCorner onSignIn={() => setLoginOpen(true)} />
            </div>
          </div>
          {page}
        </main>

        <SystemTheme />
        <ExtensionCornerLink />
        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
        <WriteNoteModal open={writeOpen} onClose={() => setWriteOpen(false)} />
      </div>
    </LoginPromptProvider>
  );
}
