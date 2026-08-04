import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "wxt";
import tailwindcss from "tailwindcss";
import { ASSUME_ALL_URLS } from "./utils/permissionsMode";

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
  // The auto sources zip must never carry the Chrome signing PRIVATE key
  // (present only on dev machines, gitignored) or local store assets. Note
  // the zip is incomplete for AMO anyway (imports from ../everything-shared
  // etc. are outside sourcesRoot) — reviewer sources are built with
  // `git archive` instead; this guard is defense in depth.
  zip: { excludeSources: ["chrome-signing-key.pem", "store-assets/**"] },
  manifest: ({ browser }) => ({
    version: "0.1.1",
    name: "Common Notes",
    description: "Community Notes Everywhere (Go to commonnotes.net to see which pages we currently support)",
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    action: { default_icon: { 16: "icon/16.png", 32: "icon/32.png" } },
    permissions: ["storage", "identity", "contextMenus", "activeTab", "tabs", "scripting", "alarms"],
    // Two permission models, switched by utils/permissionsMode.ts:
    //   ASSUME_ALL_URLS — required all-sites access; the background registers
    //   the generic script for every noted hostname silently. One big
    //   install warning, zero per-site friction.
    //   default (redirect mode) — substack.com for the background's
    //   canonical fetches, supabase.co for content-script fetches in Firefox
    //   (which blocks cross-origin fetches to non-permissioned hosts);
    //   everything else is optional, granted per site via grant.html.
    ...(ASSUME_ALL_URLS
      ? { host_permissions: ["<all_urls>"] }
      : {
          host_permissions: ["*://*.substack.com/*", "https://*.supabase.co/*"],
          // optional_host_permissions is an MV3-only key — WXT silently drops
          // it from the Firefox MV2 build, which made permissions.request
          // reject on every grant. MV2 spells it optional_permissions.
          ...(browser === "firefox"
            ? { optional_permissions: ["<all_urls>"] }
            : { optional_host_permissions: ["<all_urls>"] }),
        }),
    ...(browser === "chrome" ? { key: CHROME_PUBLIC_KEY } : {}),
    browser_specific_settings: {
      // Stable add-on ID so the OAuth redirect URL (…extensions.allizom.org)
      // stays constant across Firefox installs. NOT the original id: AMO
      // permanently burns an id when its add-on is deleted, which happened
      // to common-notes@commonnotes.net during the first submission attempt
      // (Aug 2026). Never delete the AMO listing — the id dies with it.
      gecko: {
        id: "extension@commonnotes.net",
        // Mozilla's built-in data consent (mandatory for new AMO submissions
        // since Nov 2025; Firefox 140+ shows it at install). Reading notes
        // sends the covered page's URL to our API; signing in is optional and
        // carries the user's email plus auth credentials/session.
        data_collection_permissions: {
          required: ["browsingActivity"],
          optional: ["authenticationInfo", "personallyIdentifyingInfo"],
        },
      },
    },
  }),
  hooks: {
    "build:manifestGenerated": (_wxt, manifest) => {
      // The generic content script injects at runtime on arbitrary origins,
      // so WXT can't know its CSS's matches — it emits an empty list, which
      // would block the shadow-root UI from fetching the stylesheet.
      const RUNTIME_INJECTED_CSS = ["content-scripts/generic.css"];
      for (const resource of manifest.web_accessible_resources ?? []) {
        if (typeof resource === "object" && "resources" in resource && RUNTIME_INJECTED_CSS.some((css) => resource.resources.includes(css))) {
          resource.matches = ["<all_urls>"];
        }
      }
    },
  },
  vite: () => ({
    envDir: repoRoot,
    // Unminified on purpose: extension code loads from disk (no network win),
    // Mozilla recommends against minifying, and minified output is not
    // path-reproducible (the minifier's name assignment follows module ids,
    // which embed absolute paths) — AMO reviewers must rebuild our source and
    // get a byte-identical diff, which only works unminified.
    build: { minify: false },
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
        // WXT defines process.env.NODE_ENV as the MODE NAME in every bundle
        // (its lib-mode per-entrypoint config even overrides a user define),
        // so `--mode prod-backend` ships React's DEVELOPMENT build (~2× size,
        // dev-only code paths) in all content scripts. A plugin config hook
        // runs after that merge, in WXT's child builds too. Dev serve keeps
        // the dev runtime (react-refresh needs it).
        name: "cn-force-prod-react",
        config(config: { define?: Record<string, unknown> }, { command }: { command: string }) {
          if (command !== "build") return;
          (config.define ??= {})["process.env.NODE_ENV"] = JSON.stringify("production");
          // Also flip the PROCESS env: Vite's isProduction (and with it
          // plugin-react's choice of the production JSX transform — the dev
          // transform bakes absolute-path _jsxFileName vars into the output)
          // follows process.env.NODE_ENV, which WXT set to the mode name.
          process.env.NODE_ENV = "production";
        },
      },
      {
        // Rolldown's unminified output labels each module with a //#region
        // comment carrying its id; WXT's virtual entrypoint ids embed the
        // repo's ABSOLUTE path. Strip the machine-specific prefix so a
        // rebuild from any directory is byte-identical (AMO reviewers diff
        // their rebuild against the submitted files).
        name: "cn-path-independent-output",
        renderChunk(code: string) {
          return code.includes(repoRoot) ? code.split(repoRoot).join("") : null;
        },
      },
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
