import { createRoot } from "react-dom/client";
import "../../assets/tailwind.css";
import { initUiAnalytics } from "../../utils/analytics";
import { SettingsApp } from "./App";

initUiAnalytics();

createRoot(document.getElementById("root")!).render(<SettingsApp />);
