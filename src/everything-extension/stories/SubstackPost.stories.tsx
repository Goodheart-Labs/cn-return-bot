import type { Meta, StoryObj } from "@storybook/react-vite";
import { CHART_IMAGE, PAGE_ITEM, PAGE_SEEDS } from "../../everything-storybook/fixtures";
import { SubstackPostPage } from "./mocks/SubstackPostPage";

/* Click a marker or a tinted passage to open a note. */
const meta = {
  title: "Extension/Substack post",
  component: SubstackPostPage,
  parameters: { layout: "fullscreen", queries: PAGE_SEEDS },
  globals: { scale: "extension" },
  args: { noteStyle: "margin", item: PAGE_ITEM, chartImage: CHART_IMAGE },
  argTypes: { noteStyle: { control: "inline-radio", options: ["margin", "classic"] }, item: { table: { disable: true } }, chartImage: { table: { disable: true } } },
} satisfies Meta<typeof SubstackPostPage>;
export default meta;

type Story = StoryObj<typeof meta>;

export const MarginNotes: Story = { name: "Notes in the margin" };
export const ClassicBadges: Story = { name: "Badge and popover", args: { noteStyle: "classic" } };
