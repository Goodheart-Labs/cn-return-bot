import type { Decorator } from "@storybook/react-vite";

/** Renders the story as the website page at the given address. The website
 *  keeps its route in query parameters, so the story rewrites the preview
 *  frame's own address before it renders. Storybook's parameters, the story
 *  id and the view mode, are kept. */
export const withWebsiteRoute = (params: Record<string, string>): Decorator => (Story) => {
  const url = new URL(window.location.href);
  for (const key of ["project", "item", "note", "view"]) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  window.history.replaceState(null, "", url);
  return (
    <div className="bg-canvas text-fg font-sans min-h-screen">
      <Story />
    </div>
  );
};
