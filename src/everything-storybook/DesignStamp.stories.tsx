import type { Meta } from "@storybook/react-vite";
import { websiteDesignStories } from "./designStories";

const meta = { title: "Designs/A. Stamp/Website" } satisfies Meta;
export default meta;

const stories = websiteDesignStories("stamp");
export const Homepage = stories.Homepage;
export const NotesPage = stories.NotesPage;
