import React from "react";
import { Button } from "@cn/ui/Button";
import { Page } from "@cn/ui/Page";
import { PageTitle } from "@cn/ui/typography";

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
      <Page width="form" className="space-y-3">
        <PageTitle>Common Notes could not load</PageTitle>
        <p className="text-sm text-fg-secondary">
          Something went wrong while showing this page. Reloading usually fixes it.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </Page>
    );
  }
}
