import { addons } from "storybook/manager-api";
import { create } from "storybook/theming";

/* Storybook's own frame, the sidebar and toolbar around the stories. */
addons.setConfig({
  theme: create({ base: "light", brandTitle: "Common Notes design system" }),
});
