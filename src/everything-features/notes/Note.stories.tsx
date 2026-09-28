import type { Meta, StoryObj } from "@storybook/react-vite";
import { FEED_SEEDS, noteById } from "../../everything-storybook/fixtures";
import { Note } from "./Note";

const meta = {
  title: "Features/Note",
  component: Note,
  parameters: { queries: FEED_SEEDS },
  args: { note: noteById("note-rent"), shareUrl: "https://commonnotes.net/?note=note-rent" },
  decorators: [(Story) => <div className="max-w-xl"><Story /></div>],
} satisfies Meta<typeof Note>;
export default meta;

type Story = StoryObj<typeof meta>;

export const RatedHelpful: Story = { name: "Rated helpful" };
export const NeedsRatings: Story = { name: "Needs more ratings", args: { note: noteById("note-permits") } };
export const RatedNotHelpful: Story = { name: "Rated not helpful", args: { note: noteById("note-grid") } };
export const WrittenByAReader: Story = { name: "Written by a reader", args: { note: noteById("note-rent-improved") } };
