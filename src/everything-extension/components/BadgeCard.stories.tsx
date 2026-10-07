import type { Meta, StoryObj } from "@storybook/react-vite";
import { BadgeCard } from "./BadgeCard";

const meta = {
  title: "Extension/Listing badge card",
  component: BadgeCard,
  globals: { scale: "extension" },
  args: { mark: { checked: true }, noun: "post", onClose: () => {} },
} satisfies Meta<typeof BadgeCard>;
export default meta;

export const Checked: StoryObj<typeof meta> = { name: "Checked, nothing found" };
export const WithNotes: StoryObj<typeof meta> = { name: "Video with notes", args: { mark: { count: 3 }, noun: "video" } };
