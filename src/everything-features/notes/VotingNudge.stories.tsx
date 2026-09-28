import type { Meta, StoryObj } from "@storybook/react-vite";
import { VotingNudge } from "./VotingNudge";

const meta = {
  title: "Features/Voting hint",
  component: VotingNudge,
  args: { onDismiss: () => {} },
  decorators: [(Story) => <div className="relative ml-80 mt-32 inline-block"><Story /><span className="text-sm text-fg-muted">The rating pills sit here</span></div>],
} satisfies Meta<typeof VotingNudge>;
export default meta;

export const Default: StoryObj<typeof meta> = {};
