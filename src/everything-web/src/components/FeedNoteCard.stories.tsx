import type { Meta, StoryObj } from "@storybook/react-vite";
import { FEED_SEEDS, NNN_ENTRIES, noteById } from "../../../everything-storybook/fixtures";
import { FeedNoteCard } from "./FeedNoteCard";

const meta = {
  title: "Website/Feed card",
  component: FeedNoteCard,
  parameters: { queries: FEED_SEEDS },
  args: {
    note: noteById("note-rent"),
    improvements: [noteById("note-rent-improved")],
    nnnEntries: NNN_ENTRIES,
    shareUrl: "https://commonnotes.net/notes/rational-rent?note=note-rent",
  },
} satisfies Meta<typeof FeedNoteCard>;
export default meta;

type Story = StoryObj<typeof meta>;

export const WithContextAndImprovement: Story = { name: "With context and an improvement" };
export const ClaimFromAnImage: Story = { name: "Claim from an image", args: { note: noteById("note-permits"), improvements: [], nnnEntries: [] } };
export const SourceHasChanged: Story = { name: "Source has since changed", args: { note: noteById("note-battery"), improvements: [], nnnEntries: [] } };
