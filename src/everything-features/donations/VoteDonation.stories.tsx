import type { Meta, StoryObj } from "@storybook/react-vite";
import { VoteDonation } from "./VoteDonation";

const meta = {
  title: "Features/Donation notice",
  component: VoteDonation,
  args: { voteId: "vote-1", pair: { ifHelpful: 3.08, ifNotHelpful: 0.5 }, charity: "give_directly", status: "needs_ratings", onCharityChange: () => {}, onClose: () => {} },
  argTypes: { status: { control: "inline-radio", options: ["needs_ratings", "helpful", "not_helpful"] } },
  decorators: [(Story) => <div className="max-w-xl"><Story /></div>],
} satisfies Meta<typeof VoteDonation>;
export default meta;

type Story = StoryObj<typeof meta>;

export const NoteStillOpen: Story = { name: "Note still open" };
export const NoteRatedHelpful: Story = { name: "Note rated helpful", args: { status: "helpful" } };
