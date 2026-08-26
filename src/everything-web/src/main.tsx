import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

/* The feed is rendered before analytics starts. Counting a visit is the least
 * important thing this file does, and doing it first once meant that a browser
 * which refuses access to storage threw here and the reader got a blank page.
 * Rendering first means the worst an analytics failure can now do is lose one
 * pageview. */
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

initAnalytics();
