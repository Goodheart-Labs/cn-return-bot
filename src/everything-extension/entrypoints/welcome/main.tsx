import { createRoot } from "react-dom/client";
import "../../assets/tailwind.css";
import { initUiAnalytics } from "../../utils/analytics";
import { WelcomeApp } from "./App";

initUiAnalytics();

createRoot(document.getElementById("root")!).render(<WelcomeApp />);
