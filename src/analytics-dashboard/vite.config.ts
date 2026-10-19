import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { ENV_DIR, settleSupabaseEnv } from "../cnEnv";

// BASE_PATH is set by the GitHub Pages workflow to "/cn-return-bot/analytics/"
// so asset URLs are correctly prefixed for the project-pages subpath. Local
// dev uses "/". The root .env feeds local dev, and only variables prefixed
// with VITE_ reach the client.

export default defineConfig(({ command, mode }) => {
  settleSupabaseEnv(command, mode);
  return {
    plugins: [react()],
    base: process.env.BASE_PATH ?? "/",
    envDir: ENV_DIR,
  };
});
