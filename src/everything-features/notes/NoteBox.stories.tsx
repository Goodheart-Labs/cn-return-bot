import type { Meta, StoryObj } from "@storybook/react-vite";
import { FEED_SEEDS, noteById } from "../../everything-storybook/fixtures";
import { NoteBox, StatusBadge } from "./NoteBox";

const meta = {
  title: "Features/Note box",
  component: NoteBox,
  parameters: { queries: FEED_SEEDS },
  args: { note: noteById("note-rent"), status: "helpful", sourcesOpen: false },
  argTypes: { status: { control: "inline-radio", options: ["helpful", "needs_ratings", "not_helpful"] } },
  decorators: [(Story) => <div className="max-w-xl"><Story /></div>],
} satisfies Meta<typeof NoteBox>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
export const WithSourceDetails: Story = { name: "Source details open", args: { sourcesOpen: true } };

export const StatusBadges: Story = {
  name: "Status badges",
  render: () => (
    <div className="space-y-2">
      <StatusBadge status="helpful" />
      <StatusBadge status="needs_ratings" />
      <StatusBadge status="not_helpful" />
    </div>
  ),
};
