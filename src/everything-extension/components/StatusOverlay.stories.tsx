import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusOverlay } from "./StatusOverlay";

const meta = {
  title: "Extension/Status card",
  component: StatusOverlay,
  globals: { scale: "extension" },
  args: { headline: "We already checked this post" },
} satisfies Meta<typeof StatusOverlay>;
export default meta;

export const AlreadyChecked: StoryObj<typeof meta> = { name: "Request not needed" };
