import * as path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";

/* The GitHub Pages workflow sets BASE_PATH to "/cn-return-bot/notes/" so that
 * asset URLs carry the project-pages subpath. Local development uses "/"
 * instead. envDir points at the repo root, so the root .env feeds local
 * development. Only variables prefixed with VITE_ reach the client. */
const envDir = path.resolve(__dirname, "../..");

export default defineConfig(({ command, mode }) => {
  /* A build without the Supabase environment variables is never valid. Vite
   * inlines them as `undefined`, which turns the guard at the top of
   * everything-shared/supabase.ts into an unconditional throw. The bundler then
   * removes the whole app as dead code, and the build still exits green. So
   * fail loudly here instead. Development is exempt, because there the guard
   * throws at runtime and the browser shows it straight away. */
  const env = loadEnv(mode, envDir, "");
  if (command === "build" && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error(
      "Refusing to build without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — " +
        "the app would be dead-code-eliminated. Use --mode prod-backend or set the env vars.",
    );
  }
  /* In prod-backend mode without a .env.prod-backend file, Vite silently falls
   * back to the root .env. You would then be testing against the local backend
   * while believing you are on production. So fail loudly here. This check runs
   * in development too, because the fallback is invisible in the browser. */
  if (mode === "prod-backend" && (!env.VITE_SUPABASE_URL || /127\.0\.0\.1|localhost/.test(env.VITE_SUPABASE_URL))) {
    throw new Error(
      "prod-backend mode resolved a missing/local VITE_SUPABASE_URL — " +
        ".env.prod-backend is probably absent in this worktree (it's gitignored; copy it from the main checkout).",
    );
  }
  return {
    plugins: [react()],
    base: process.env.BASE_PATH ?? "/",
    envDir,
    /* Tailwind is wired inline instead of via a postcss.config file, whose
     * discovery depends on the working directory. */
    css: { postcss: { plugins: [tailwindcss({ config: path.resolve(__dirname, "tailwind.config.ts") })] } },
  };
});
