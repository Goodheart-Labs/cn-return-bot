import type { Meta, StoryObj } from "@storybook/react-vite";
import { NOTES, PROJECTS } from "../../../../everything-storybook/fixtures";
import { BestNotesReorder, type ReorderEntry } from "./BestNotesReorder";

const ENTRY_COUNT = 60;

/* Enough rows that dragging from the bottom to the top needs edge scrolling.
 * The rows reuse the fixture notes under new ids. */
const ENTRIES: ReorderEntry[] = Array.from({ length: ENTRY_COUNT }, (_, i) => {
  const note = NOTES[i % NOTES.length]!;
  const id = `best-${i + 1}`;
  return {
    row: { note_id: id, position: i, comment: null, posted_at: null },
    note: { ...note, id, note: `Note ${i + 1}. ${note.note}` },
    project: PROJECTS[i % PROJECTS.length],
  };
});

const meta = {
  title: "Website/Best notes reorder",
  component: BestNotesReorder,
  args: {
    entries: ENTRIES,
    list: ENTRIES.map((entry) => entry.row),
    onMove: (noteId: string, position: number) => console.log("moved", noteId, position),
  },
} satisfies Meta<typeof BestNotesReorder>;
export default meta;

export const Rows: StoryObj<typeof meta> = {};
