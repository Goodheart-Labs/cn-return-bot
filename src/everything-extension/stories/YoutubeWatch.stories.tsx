import type { Meta, StoryObj } from "@storybook/react-vite";
import { PAGE_ITEM, PAGE_SEEDS } from "../../everything-storybook/fixtures";
import { VIDEO_SECONDS, YoutubeWatch } from "./mocks/YoutubeWatchPage";

/* Drag the "seconds" control to move playback: the note card appears while
 * playback is inside a claim's span and fades after it. */
const meta = {
  title: "Extension/YouTube video",
  component: YoutubeWatch,
  parameters: { layout: "fullscreen", queries: PAGE_SEEDS },
  globals: { scale: "extension" },
  args: { seconds: 12, item: PAGE_ITEM },
  argTypes: { seconds: { control: { type: "range", min: 0, max: VIDEO_SECONDS, step: 1 } }, item: { table: { disable: true } } },
} satisfies Meta<typeof YoutubeWatch>;
export default meta;

type Story = StoryObj<typeof meta>;

export const DuringAClaim: Story = { name: "During a claim" };
export const BetweenClaims: Story = { name: "Between claims", args: { seconds: 25 } };
