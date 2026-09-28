import type { Meta, StoryObj } from "@storybook/react-vite";
import { NNN_ENTRIES } from "../../everything-storybook/fixtures";
import { NoteNotNeeded } from "./NoteNotNeeded";

const meta = {
  title: "Features/Note not needed",
  component: NoteNotNeeded,
  args: { entries: NNN_ENTRIES },
  decorators: [(Story) => <div className="max-w-xl"><Story /></div>],
} satisfies Meta<typeof NoteNotNeeded>;
export default meta;

export const Collapsed: StoryObj<typeof meta> = {};
