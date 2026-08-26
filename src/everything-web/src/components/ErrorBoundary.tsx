import React from "react";
import { BUTTON } from "../../../everything-shared/ui";

/* The last line of defence against a blank page. React unmounts the whole tree
 * when a render throws, and with nothing in its place the reader is left
 * looking at an empty white window with no way to tell what went wrong. This
 * shows a short message and a reload button instead, and puts the error in the
 * console for us. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Common Notes failed to render", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="max-w-lg mx-auto px-4 py-16 space-y-3">
        <h1 className="text-xl font-extrabold">Common Notes could not load</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Something went wrong while showing this page. Reloading usually fixes it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className={BUTTON}
        >
          Reload
        </button>
      </div>
    );
  }
}
