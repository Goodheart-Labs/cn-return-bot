import type { Meta } from "@storybook/react-vite";
import { websiteDesignStories } from "./designStories";

const meta = { title: "Designs/C. The sketch, straight/Website" } satisfies Meta;
export default meta;

const stories = websiteDesignStories("canon");
export const Homepage = stories.Homepage;
export const NotesPage = stories.NotesPage;
