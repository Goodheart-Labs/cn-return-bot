import type { Meta, StoryObj } from "@storybook/react-vite";
import { VotingNudge } from "./VotingNudge";

const meta = {
  title: "Features/Voting hint",
  component: VotingNudge,
  args: { onDismiss: () => {} },
  // The hint takes the place of the question in a note's rating panel.
  decorators: [(Story) => <div className="max-w-xl rounded-card bg-surface-muted px-4 py-3 text-sm text-fg"><Story /></div>],
} satisfies Meta<typeof VotingNudge>;
export default meta;

export const Default: StoryObj<typeof meta> = {};
