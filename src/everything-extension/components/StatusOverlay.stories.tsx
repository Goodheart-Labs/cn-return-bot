import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusOverlay } from "./StatusOverlay";

const meta = {
  title: "Extension/Status card",
  component: StatusOverlay,
  globals: { scale: "extension" },
  args: { headline: "2 Common Notes on this post, 1 needs more ratings", onHeadlineClick: () => {} },
} satisfies Meta<typeof StatusOverlay>;
export default meta;

export const NotesOnThisPage: StoryObj<typeof meta> = { name: "Notes on this page" };
export const NothingToNote: StoryObj<typeof meta> = { name: "Checked, nothing to note", args: { headline: "We checked this post and found nothing to note", onHeadlineClick: undefined } };
