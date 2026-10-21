import * as path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import { CN_ALIASES } from "../cnAliases";
import { ENV_DIR, settleSupabaseEnv } from "../cnEnv";
import { draftsApi } from "./draftsApi";

/* The note review dashboard (GOO-504). It only runs as a local development
 * server, because its API posts notes to prod with the service key. */
export default defineConfig(({ command, mode }) => {
  settleSupabaseEnv(command, mode);
  return {
    plugins: [react(), draftsApi],
    resolve: { alias: CN_ALIASES },
    envDir: ENV_DIR,
    css: { postcss: { plugins: [tailwindcss({ config: path.resolve(__dirname, "tailwind.config.ts") })] } },
  };
});
