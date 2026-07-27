import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "wxt";
import tailwindcss from "tailwindcss";

// Root .env feeds VITE_SUPABASE_* to import.meta.env, same as the web app's
// vite config. The anon key is public by design (RLS-locked, migration 050).
const repoRoot = path.resolve(__dirname, "../..");

// PUBLIC half of our self-generated keypair. Chrome derives the extension ID
// from it, so every install — load-unpacked from a GitHub release zip on any
// machine, or a future Web Store upload made with the same key — gets the
// SAME ID: jodkhmefbcmgldokmeicpdogkepmcnij. That makes the OAuth redirect
// URL (https://jodkhmefbcmgldokmeicpdogkepmcnij.chromiumapp.org/) known in
// advance for the Supabase allow-list. The PRIVATE key stays out of git
// (chrome-signing-key.pem, gitignored) — only needed to claim this ID on the
// Web Store later.
const CHROME_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2qdIOMvZuGlFH1UrpRid5yNL/QhfTmU6E9B2jbE5aCs3TBkrTZP6YU8LGRnPZvUAgFLrD4jUFL5eNxqWgsfzgubcNXXvDXYDdbL/jazzIayocG4GH8ONBAKOTSQaQ8s1T2PZSImbuB0I4m2I3IlYtIZKsXqM80ky42+mv04SfBQZxRgP0slrO+4QqrD300uQtBhj8XhLremut05B8mtfgOJDC7S9CT73mae0vbXJEL1dC34mEt98hT1nDGEKeNXXcEIHO3L/c1d101oBsoXG2A+O/ze0OmDIi6xqnU31YSkvcWT20mVKKZXUqz4FUFkKyRaG/mHkSs0Dt/hKePdSEQIDAQAB";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Dev mode must not spawn its own Chrome — we load the dev output unpacked
  // in the user's existing browser; WXT's dev client then hot-reloads the
  // extension (and its tabs) on every rebuild.
  webExt: { disabled: true },
  manifest: ({ browser }) => ({
    version: "0.1.0",
    name: "Common Notes",
    description: "Community notes inline on the pages you read — Substack, YouTube, ai-2040, and more on request.",
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    action: { default_icon: { 16: "icon/16.png", 32: "icon/32.png" } },
    permissions: ["storage", "identity", "contextMenus", "activeTab", "tabs", "scripting"],
    // Lets the BACKGROUND fetch substack.com (reader-URL canonical resolution
    // — the logged-out 302 to the publication domain is cross-origin, which
    // content scripts can't follow). Same scope as the substack content
    // script, so no new install warning.
    host_permissions: ["*://*.substack.com/*"],
    // Generic text sites are opt-in per site from the popup; only Substack and
    // YouTube are injected by default.
    optional_host_permissions: ["<all_urls>"],
    ...(browser === "chrome" ? { key: CHROME_PUBLIC_KEY } : {}),
    browser_specific_settings: {
      // Stable add-on ID so the OAuth redirect URL (…extensions.allizom.org)
      // stays constant across Firefox installs.
      gecko: { id: "common-notes@commonnotes.net" },
    },
  }),
  hooks: {
    "build:manifestGenerated": (_wxt, manifest) => {
      // The generic and requestnote content scripts inject at runtime on
      // arbitrary origins, so WXT can't know their CSS's matches — it emits an
      // empty list, which would block the shadow-root UI from fetching the
      // stylesheet.
      const RUNTIME_INJECTED_CSS = ["content-scripts/generic.css", "content-scripts/requestnote.css"];
      for (const resource of manifest.web_accessible_resources ?? []) {
        if (typeof resource === "object" && "resources" in resource && RUNTIME_INJECTED_CSS.some((css) => resource.resources.includes(css))) {
          resource.matches = ["<all_urls>"];
        }
      }
    },
  },
  vite: () => ({
    envDir: repoRoot,
    css: {
      // rem→px after Tailwind: rem resolves against the HOST page's <html>
      // font-size even inside a shadow root (shadow DOM does not isolate it),
      // and e.g. YouTube sets html{font-size:10px} — shrinking every rem-based
      // utility to 62.5%. Baking rem out at 1rem=16px renders the overlays
      // identically on every host.
      postcss: {
        plugins: [
          tailwindcss(path.resolve(__dirname, "tailwind.config.ts")),
          {
            postcssPlugin: "cn-rem-to-px",
            Declaration(decl: { value: string }) {
              if (decl.value.includes("rem")) {
                decl.value = decl.value.replace(/(\d*\.?\d+)rem\b/g, (_, n) => `${parseFloat(n) * 16}px`);
              }
            },
          },
        ],
      },
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
