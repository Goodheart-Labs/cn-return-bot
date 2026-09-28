import type { Meta } from "@storybook/react-vite";
import { CHART_IMAGE, PAGE_ITEM, PAGE_SEEDS } from "../../everything-storybook/fixtures";
import { extensionDesignStories } from "./mocks/designStories";

const meta = { title: "Designs/A. Stamp/Extension" } satisfies Meta;
export default meta;

const stories = extensionDesignStories("stamp", { item: PAGE_ITEM, chartImage: CHART_IMAGE, queries: PAGE_SEEDS });
export const SubstackPost = stories.SubstackPost;
export const YoutubeVideo = stories.YoutubeVideo;
