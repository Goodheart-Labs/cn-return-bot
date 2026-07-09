import * as path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH is set by the GitHub Pages workflow to "/cn-return-bot/notes/" so
// asset URLs are correctly prefixed for the project-pages subpath. Local dev
// uses "/". envDir points at the repo root so the root .env feeds local dev
// (only VITE_-prefixed vars are exposed to the client).
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/",
  envDir: path.resolve(__dirname, "../.."),
});
