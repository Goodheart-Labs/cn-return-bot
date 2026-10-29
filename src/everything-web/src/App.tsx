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
import { TWEET_SERVER } from "./pages/noteReview/tweetServer";
import { NotesView } from "./pages/NotesView";

/** The dashboard's and the X notewriter page's charts pull in a chart library
 *  that most readers never need, so their code loads only when someone opens
 *  one of those pages. */
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const XNotewriterPage = lazy(() => import("./pages/notewriter/XNotewriterPage").then((module) => ({ default: module.XNotewriterPage })));
const JudgeExperimentPage = lazy(() => import("./pages/judgeExperiment/JudgeExperimentPage").then((module) => ({ default: module.JudgeExperimentPage })));

/** The website's frame: the header on every page, the page the route names
 *  below it, and the extension nudge, which counts time across pages. The
 *  local posting tool is only the review page, at any address, plus the note
 *  picture page its server photographs. It has no frame. */
export function App() {
  const [route, navigate] = useRoute();
  const [loginOpen, setLoginOpen] = useState(false);
  useAuthAnalytics();

  return (
    <LoginPromptProvider value={() => setLoginOpen(true)}>
      {!TWEET_SERVER && <SiteHeader route={route} navigate={navigate} onSignIn={() => setLoginOpen(true)} />}
      {route.view === "noteImage" ? <NoteImagePage noteId={route.note} />
        : TWEET_SERVER || route.view === "noteReview" ? <NoteReviewPage />
        : route.view === "home" ? <HomePage showInstall={route.section === "install"} navigate={navigate} />
        : route.view === "minisites" ? (route.slug ? <MinisitePage key={route.slug} slug={route.slug} navigate={navigate} /> : <MinisitesPage navigate={navigate} />)
        : route.view === "newMinisite" ? <CreateMinisitePage navigate={navigate} />
        : route.view === "dashboard" ? (
          <Suspense fallback={<p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>}>
            <DashboardPage section={route.section} navigate={navigate} />
          </Suspense>
        )
        : route.view === "xNotewriter" ? (
          <Suspense fallback={<p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>}>
            <XNotewriterPage page={route.page} navigate={navigate} />
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
      {!TWEET_SERVER && <ExtensionNudge route={route} navigate={navigate} />}
    </LoginPromptProvider>
  );
}
