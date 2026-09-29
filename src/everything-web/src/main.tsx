import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@cn/features/query/queryClient";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SystemTheme } from "./components/SystemTheme";
import { initAnalytics } from "./lib/analytics";
import { upgradeLegacyAddress } from "./lib/routing";
import "./index.css";

/* The feed is rendered before analytics starts. Counting a visit is the least
 * important thing this file does, and doing it first once meant that a browser
 * which refuses access to storage threw here and the reader got a blank page.
 * Rendering first means the worst an analytics failure can now do is lose one
 * pageview. */
upgradeLegacyAddress();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
      <SystemTheme />
    </ErrorBoundary>
  </React.StrictMode>,
);

initAnalytics();
