import type { Meta, StoryObj } from "@storybook/react-vite";
import { RequestProgressCard } from "./RequestProgressCard";

const meta = {
  title: "Extension/Request progress",
  component: RequestProgressCard,
  globals: { scale: "extension" },
  args: { progress: { kind: "saved" }, onDismiss: () => {} },
} satisfies Meta<typeof RequestProgressCard>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Waiting: Story = {};
export const Checking: Story = { args: { progress: { kind: "checking", done: 5, total: 14, notes: 1 } } };
export const Done: Story = { args: { progress: { kind: "done", notes: 2 }, onJump: () => {} } };
