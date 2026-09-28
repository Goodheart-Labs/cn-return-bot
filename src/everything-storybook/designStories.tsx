import type { StoryObj } from "@storybook/react-vite";
import { App } from "../everything-web/src/App";
import type { LookId } from "../everything-web/src/pages/home/variants";
import { withWebsiteRoute } from "./decorators";
import { FEED_SEEDS } from "./fixtures";

/** The website pages of one candidate design. Each story pins the design, so
 *  the folder shows that design whatever the toolbar says. The extension's
 *  surfaces of the same design live in everything-extension/stories. */
export function websiteDesignStories(look: LookId): Record<"Homepage" | "NotesPage", StoryObj> {
  const page = (route: Record<string, string>): StoryObj => ({
    render: () => <App />,
    parameters: { layout: "fullscreen", queries: FEED_SEEDS },
    globals: { look, scale: "website" },
    decorators: [withWebsiteRoute(route)],
  });
  return { Homepage: page({}), NotesPage: { ...page({ view: "notes" }), name: "Notes page" } };
}
