import { lazy, Suspense, useState } from "react";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import { ExtensionNudge } from "./components/ExtensionNudge";
import { LoginModal } from "./components/LoginModal";
import { SiteHeader } from "./components/SiteHeader";
import { useRoute } from "./lib/routing";
import { useAuthAnalytics } from "./lib/useAuthAnalytics";
import { HomePage } from "./pages/home/HomePage";
import { CreateMinisitePage } from "./pages/minisites/CreateMinisitePage";
import { MinisitePage } from "./pages/minisites/MinisitePage";
import { MinisitesPage } from "./pages/minisites/MinisitesPage";
import { BestNotesPage } from "./pages/bestNotes/BestNotesPage";
import { NoteImagePage } from "./pages/noteReview/NoteImagePage";
import { NoteReviewPage } from "./pages/noteReview/NoteReviewPage";
import { NotesView } from "./pages/NotesView";

/** The dashboard's charts pull in a chart library that no reader needs, so
 *  its code loads only when an admin opens the page. */
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const JudgeExperimentPage = lazy(() => import("./pages/judgeExperiment/JudgeExperimentPage").then((module) => ({ default: module.JudgeExperimentPage })));

/** The website's frame: the header on every page, the page the route names
 *  below it, and the extension nudge, which counts time across pages. */
export function App() {
  const [route, navigate] = useRoute();
  const [loginOpen, setLoginOpen] = useState(false);
  useAuthAnalytics();

  return (
    <LoginPromptProvider value={() => setLoginOpen(true)}>
      <SiteHeader route={route} navigate={navigate} onSignIn={() => setLoginOpen(true)} />
      {route.view === "home" ? <HomePage showInstall={route.section === "install"} navigate={navigate} />
        : route.view === "minisites" ? (route.slug ? <MinisitePage key={route.slug} slug={route.slug} navigate={navigate} /> : <MinisitesPage navigate={navigate} />)
        : route.view === "newMinisite" ? <CreateMinisitePage navigate={navigate} />
        : route.view === "noteReview" ? <NoteReviewPage />
        : route.view === "noteImage" ? <NoteImagePage noteId={route.note} />
        : route.view === "dashboard" ? (
          <Suspense fallback={<p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>}>
            <DashboardPage navigate={navigate} />
          </Suspense>
        )
        : route.view === "judgeExperiment" ? (
          <Suspense fallback={<p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>}>
            <JudgeExperimentPage section={route.section} navigate={navigate} />
          </Suspense>
        )
        : route.view === "bestNotes" ? <BestNotesPage projectSlug={route.project} navigate={navigate} />
        : <NotesView route={route} navigate={navigate} />}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <ExtensionNudge route={route} navigate={navigate} />
    </LoginPromptProvider>
  );
}
