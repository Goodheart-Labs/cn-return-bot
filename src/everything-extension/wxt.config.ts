import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "wxt";
import tailwindcss from "tailwindcss";

// Root .env feeds VITE_SUPABASE_* to import.meta.env, same as the web app's
// vite config. The anon key is public by design (RLS-locked, migration 050).
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    version: "0.1.0",
    name: "Common Notes",
    description: "Community notes inline on the pages you read — Substack, YouTube, and any text site.",
    permissions: ["storage", "identity", "contextMenus", "activeTab", "tabs", "scripting"],
    // Generic text sites are opt-in per site from the popup; only Substack and
    // YouTube are injected by default.
    optional_host_permissions: ["<all_urls>"],
    browser_specific_settings: {
      // Stable add-on ID so the OAuth redirect URL (…extensions.allizom.org)
      // stays constant across Firefox installs.
      gecko: { id: "common-notes@commonnotes.net" },
    },
  },
  hooks: {
    "build:manifestGenerated": (_wxt, manifest) => {
      // The generic content script registers at runtime for user-chosen
      // origins, so WXT can't know its CSS's matches — it emits an empty list,
      // which would block the shadow-root UI from fetching the stylesheet.
      for (const resource of manifest.web_accessible_resources ?? []) {
        if (typeof resource === "object" && "resources" in resource && resource.resources.includes("content-scripts/generic.css")) {
          resource.matches = ["<all_urls>"];
        }
      }
    },
  },
  vite: () => ({
    envDir: repoRoot,
    css: {
      postcss: { plugins: [tailwindcss(path.resolve(__dirname, "tailwind.config.ts"))] },
    },
    plugins: [
      {
        // Same guard as everything-web/vite.config.ts: a build without the
        // Supabase env inlines `undefined`, turning the module-scope check in
        // everything-shared/supabase.ts into an unconditional throw. Fail the
        // build loudly instead; dev surfaces the throw at runtime.
        name: "require-supabase-env",
        config(_config, { command, mode }) {
          if (command !== "build") return;
          const env = loadEnv(mode, repoRoot, "");
          if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
            throw new Error("Refusing to build without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (root .env)");
          }
        },
      },
    ],
  }),
});
