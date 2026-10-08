import { existsSync } from "fs";
import * as path from "path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import { CN_ALIASES } from "../cnAliases";
import { ENV_DIR, settleSupabaseEnv } from "../cnEnv";

/* The static pages in public/, such as /privacy/, are folders with an
 * index.html. The hosts serve that file for the folder's address, but Vite's
 * development server answers every address it has no exact file for with the
 * app. So in development a folder address with an index.html is pointed at
 * that file. */
const publicFolderPages: Plugin = {
  name: "public-folder-pages",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const address = req.url?.split("?")[0];
      if (address && address !== "/" && existsSync(path.join(__dirname, "public", address, "index.html"))) {
        req.url = path.posix.join(address, "index.html");
      }
      next();
    });
  },
};

export default defineConfig(({ command, mode }) => {
  settleSupabaseEnv(command, mode);
  return {
    plugins: [react(), publicFolderPages],
    resolve: { alias: CN_ALIASES },
    /* The root .env feeds local development. Only variables prefixed with
     * VITE_ reach the client. */
    envDir: ENV_DIR,
    /* Tailwind is wired inline instead of via a postcss.config file, whose
     * discovery depends on the working directory. */
    css: { postcss: { plugins: [tailwindcss({ config: path.resolve(__dirname, "tailwind.config.ts") })] } },
  };
});
