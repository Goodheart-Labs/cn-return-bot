import { createRoot } from "react-dom/client";
import "../../assets/tailwind.css";
import { initUiAnalytics } from "../../utils/analytics";
import { PopupApp } from "./App";

initUiAnalytics();

createRoot(document.getElementById("root")!).render(<PopupApp />);
