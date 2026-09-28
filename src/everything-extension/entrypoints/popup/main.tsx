import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@cn/features/query/queryClient";
import "../../assets/tailwind.css";
import { initUiAnalytics } from "../../utils/analytics";
import { PopupApp } from "./App";

initUiAnalytics();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <PopupApp />
  </QueryClientProvider>,
);
