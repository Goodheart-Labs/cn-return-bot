import { existsSync, readFileSync } from "fs";
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

/* The investigations in src/scripts_jim keep their results in a data/ folder
 * that git ignores. Pages that exist only in development, such as the note
 * judge experiment, read those files at /__scripts_jim/<folder>/data/<file>.
 * Only the development server answers this address, and only with files in
 * a data/ folder. */
const SCRIPTS_JIM = path.resolve(__dirname, "../scripts_jim");
const investigationData: Plugin = {
  name: "investigation-data",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__scripts_jim", (req, res) => {
      const file = path.resolve(SCRIPTS_JIM, "." + decodeURIComponent(req.url?.split("?")[0] ?? ""));
      const inDataFolder = file.startsWith(SCRIPTS_JIM + path.sep) && file.split(path.sep).includes("data");
      if (!inDataFolder || !existsSync(file)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(readFileSync(file));
    });
  },
};

export default defineConfig(({ command, mode }) => {
  settleSupabaseEnv(command, mode);
  return {
    plugins: [react(), publicFolderPages, investigationData],
    resolve: { alias: CN_ALIASES },
    /* The root .env feeds local development. Only variables prefixed with
     * VITE_ reach the client. */
    envDir: ENV_DIR,
    /* Tailwind is wired inline instead of via a postcss.config file, whose
     * discovery depends on the working directory. */
    css: { postcss: { plugins: [tailwindcss({ config: path.resolve(__dirname, "tailwind.config.ts") })] } },
    /* Jim opens the development server on his Mac through an SSH tunnel with
     * a round trip of about 190 ms. Normally the development server sends
     * every source file on its own, and one page needed 187 requests. In
     * bundled mode it sends a handful of bundles instead, which saved about
     * 3 seconds per page load (GOO-561). Vite marks the mode as experimental. */
    experimental: { bundledDev: true },
  };
});
