import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { parse } from "dotenv";
import { loadEnv } from "vite";

/** The repo root holds every .env file. The website, the dashboard and the
 *  extension all point Vite's envDir at it. */
export const ENV_DIR = fileURLToPath(new URL("..", import.meta.url));

const LOCAL_ADDRESS = /127\.0\.0\.1|localhost/;

/** Vite lets a variable that is already set in the process environment win
 *  over the .env files. Bun, however, loads the root .env into the environment
 *  of every Bun script, and that file points at the local database. Any build
 *  a Bun script starts inherits those values. That is how the 0.4.0 store
 *  release was built against the local database (GOO-356). So the file of the
 *  build's own mode, such as .env.prod-backend, overrides what the environment
 *  inherited. A mode without such a file, as in CI, keeps the environment's
 *  values. This must run before Vite reads the env files. A config function
 *  and a plugin's config hook both run early enough. */
function applyModeEnvFiles(mode: string): void {
  for (const file of [`.env.${mode}`, `.env.${mode}.local`]) {
    const filePath = path.join(ENV_DIR, file);
    if (existsSync(filePath)) Object.assign(process.env, parse(readFileSync(filePath)));
  }
}

/** Settles the Supabase variables for a Vite run and refuses the two settings
 *  that produce an app which looks fine but cannot work.
 *
 *  A build without the variables inlines them as `undefined`. The guard at the
 *  top of everything-core/supabase.ts then always throws, and the bundler
 *  removes the whole app as dead code while the build still exits green.
 *  Development is exempt from this check, because there the guard throws in
 *  the browser straight away.
 *
 *  The prod-backend mode must reach production. A local address there means
 *  .env.prod-backend is missing from this worktree, and you would be testing
 *  against the local database while believing you are on production. This
 *  check runs in development too, because nothing in the browser shows it. */
export function settleSupabaseEnv(command: "build" | "serve", mode: string): void {
  applyModeEnvFiles(mode);
  const env = loadEnv(mode, ENV_DIR, "");
  if (command === "build" && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error("Refusing to build without VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Use --mode prod-backend or set the variables.");
  }
  if (mode === "prod-backend" && (!env.VITE_SUPABASE_URL || LOCAL_ADDRESS.test(env.VITE_SUPABASE_URL))) {
    throw new Error(
      "The prod-backend mode resolved a missing or local VITE_SUPABASE_URL. " +
        ".env.prod-backend is probably absent in this worktree. It is gitignored, so link it from ~/dev/env/cn-return-bot/.",
    );
  }
}
