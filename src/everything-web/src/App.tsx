import { useContext, useState } from "react";
import { LoginPromptProvider } from "@cn/features/auth/loginPrompt";
import { LoginModal } from "./components/LoginModal";
import { useRoute } from "./lib/routing";
import { useAuthAnalytics } from "./lib/useAuthAnalytics";
import { LookContext, VARIANTS } from "./pages/home/variants";
import { NotesView } from "./pages/NotesView";

/** The website's frame: the header on every page, and the page the route
 *  names below it. */
export function App() {
  const [route, navigate] = useRoute();
  const [loginOpen, setLoginOpen] = useState(false);
  const { Header, Home } = VARIANTS[useContext(LookContext)];
  useAuthAnalytics();

  return (
    <LoginPromptProvider value={() => setLoginOpen(true)}>
      <Header route={route} navigate={navigate} onSignIn={() => setLoginOpen(true)} />
      {route.view === "home" ? <Home showInstall={route.section === "install"} /> : <NotesView route={route} navigate={navigate} />}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </LoginPromptProvider>
  );
}
