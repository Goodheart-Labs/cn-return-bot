import type { Meta } from "@storybook/react-vite";
import { websiteDesignStories } from "./designStories";

const meta = { title: "Designs/B. Preprint/Website" } satisfies Meta;
export default meta;

const stories = websiteDesignStories("preprint");
export const Homepage = stories.Homepage;
export const NotesPage = stories.NotesPage;
