import * as path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH is set by the GitHub Pages workflow to "/cn-return-bot/analytics/"
// so asset URLs are correctly prefixed for the project-pages subpath. Local
// dev uses "/". envDir points at the repo root so the root .env feeds local
// dev (only VITE_-prefixed vars are exposed to the client).
const envDir = path.resolve(__dirname, "../..");

export default defineConfig(({ command, mode }) => {
  // A build without the Supabase env vars is never valid: Vite inlines them as
  // `undefined`, the module-scope guard in everything-shared/supabase.ts
  // becomes an unconditional throw, and the bundler dead-code-eliminates the
  // entire app — yet the build exits green. Fail loudly instead. Dev is
  // exempt; there the runtime throw surfaces immediately in the browser.
  const env = loadEnv(mode, envDir, "");
  if (command === "build" && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error(
      "Refusing to build without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — " +
        "the app would be dead-code-eliminated. Use --mode prod-backend or set the env vars.",
    );
  }
  // prod-backend mode without .env.prod-backend silently falls back to the root
  // .env — i.e. the LOCAL backend while you think you're testing prod. Fail
  // loudly instead (dev included: the fallback is invisible in the browser).
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
  };
});
