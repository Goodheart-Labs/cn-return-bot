import type { Meta, StoryObj } from "@storybook/react-vite";
import { VoteRatings } from "./VoteRatings";

const meta = {
  title: "Features/Rating pills",
  component: VoteRatings,
  args: { helpful: 4, somewhatHelpful: 1, notHelpful: 2, showCounts: false, compact: false, onVote: () => {} },
  argTypes: { myVote: { control: "inline-radio", options: [undefined, 1, 0, -1] } },
} satisfies Meta<typeof VoteRatings>;
export default meta;

type Story = StoryObj<typeof meta>;

export const NotVotedYet: Story = { name: "Not voted yet" };
export const VotedHelpful: Story = { name: "Voted helpful", args: { myVote: 1, showCounts: true } };
export const VotedNotHelpful: Story = { name: "Voted not helpful", args: { myVote: -1, showCounts: true } };
export const Compact: Story = { args: { compact: true } };
