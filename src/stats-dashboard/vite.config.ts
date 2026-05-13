import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH is set by the GitHub Pages workflow to "/cn-return-bot/" so all
// asset URLs are correctly prefixed for the project-pages domain. Local dev
// and the bun-served dist preview both use "/".
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/",
});
