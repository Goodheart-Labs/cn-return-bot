import { useState } from "react";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import { LoginModal } from "./components/LoginModal";
import { SiteHeader } from "./components/SiteHeader";
import { useRoute } from "./lib/routing";
import { useAuthAnalytics } from "./lib/useAuthAnalytics";
import { HomePage } from "./pages/home/HomePage";
import { CreateMinisitePage } from "./pages/minisites/CreateMinisitePage";
import { MinisitePage } from "./pages/minisites/MinisitePage";
import { MinisitesPage } from "./pages/minisites/MinisitesPage";
import { NotesView } from "./pages/NotesView";

/** The website's frame: the header on every page, and the page the route
 *  names below it. */
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
        : <NotesView route={route} navigate={navigate} />}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </LoginPromptProvider>
  );
}
