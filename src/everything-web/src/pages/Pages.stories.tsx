import type { Meta, StoryObj } from "@storybook/react-vite";
import { queryKeys } from "@cn/features/query/queryKeys";
import { withWebsiteRoute } from "../../../everything-storybook/decorators";
import { FEED_SEEDS } from "../../../everything-storybook/fixtures";
import { App } from "../App";

/* The website as a reader sees it, filled from the fixtures. Clicking around
 * works: the header, the sidebar, the item links and the leaderboard link all
 * change the page. */
const meta = {
  title: "Website/Pages",
  component: App,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof App>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Home: Story = {
  parameters: { queries: FEED_SEEDS },
  decorators: [withWebsiteRoute({})],
};

export const Projects: Story = {
  parameters: { queries: FEED_SEEDS },
  decorators: [withWebsiteRoute({ view: "notes" })],
};

export const Project: Story = {
  parameters: { queries: FEED_SEEDS },
  decorators: [withWebsiteRoute({ project: "the-weekly-ledger" })],
};

export const ProjectItem: Story = {
  name: "Project, one item",
  parameters: { queries: FEED_SEEDS },
  decorators: [withWebsiteRoute({ project: "the-weekly-ledger", item: "item-1" })],
};

export const Leaderboard: Story = {
  parameters: {
    queries: [
      ...FEED_SEEDS,
      [queryKeys.leaderboard, [
        { name: "maria", rating_count: 214 },
        { name: "sam", rating_count: 97 },
        { name: "lee", rating_count: 41 },
      ]],
    ],
  },
  decorators: [withWebsiteRoute({ view: "leaderboard" })],
};
