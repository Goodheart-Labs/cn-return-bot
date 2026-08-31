import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "wxt";
import tailwindcss from "tailwindcss";

// The repo root's .env supplies the VITE_SUPABASE_* values to import.meta.env, just
// as it does in the web app's vite config. The anon key is meant to be public.
// Migration 050 locks the database down with row level security.
const repoRoot = path.resolve(__dirname, "../..");

// The public half of a keypair we generated ourselves. Chrome derives the extension
// ID from it, so every install gets the same ID, jodkhmefbcmgldokmeicpdogkepmcnij.
// That holds whether the extension is loaded unpacked from a GitHub release zip on
// any machine, or uploaded to the Web Store later with the same key. Because the ID
// is fixed, the OAuth redirect URL is known in advance and can be put on the Supabase
// allow-list. It is https://jodkhmefbcmgldokmeicpdogkepmcnij.chromiumapp.org/. The
// private key stays out of git. It lives in chrome-signing-key.pem, which is
// gitignored, and it is only needed to claim this ID on the Web Store later.
const CHROME_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2qdIOMvZuGlFH1UrpRid5yNL/QhfTmU6E9B2jbE5aCs3TBkrTZP6YU8LGRnPZvUAgFLrD4jUFL5eNxqWgsfzgubcNXXvDXYDdbL/jazzIayocG4GH8ONBAKOTSQaQ8s1T2PZSImbuB0I4m2I3IlYtIZKsXqM80ky42+mv04SfBQZxRgP0slrO+4QqrD300uQtBhj8XhLremut05B8mtfgOJDC7S9CT73mae0vbXJEL1dC34mEt98hT1nDGEKeNXXcEIHO3L/c1d101oBsoXG2A+O/ze0OmDIi6xqnU31YSkvcWT20mVKKZXUqz4FUFkKyRaG/mHkSs0Dt/hKePdSEQIDAQAB";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Dev mode must not launch its own Chrome. We load the dev output unpacked into
  // the browser the user already has open. WXT's dev client then reloads the
  // extension and its tabs on every rebuild.
  webExt: { disabled: true },
  // The sources zip WXT builds must never contain the Chrome signing private key or
  // the local store assets. That key only exists on developer machines and is
  // gitignored. The zip is not usable for an AMO submission anyway, because imports
  // such as ../everything-shared live outside sourcesRoot. We build the sources we
  // send to reviewers with `git archive` instead. This exclusion is a second line of
  // defence.
  zip: { excludeSources: ["chrome-signing-key.pem", "store-assets/**"] },
  manifest: ({ browser }) => ({
    version: "0.3.0",
    name: "Common Notes",
    description: "Community Notes Everywhere",
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    action: { default_icon: { 16: "icon/16.png", 32: "icon/32.png" } },
    permissions: ["storage", "identity", "contextMenus", "activeTab", "tabs", "scripting", "alarms"],
    // Access to every site is required at install time. The background then
    // registers the generic content script for every hostname that has notes,
    // without asking. The user sees one broad install warning and no per-site
    // prompts after that. The per-site consent flow this replaced lived in
    // grant.html; what the user can switch off now lives on the settings page
    // (overlays, thumbnail badges, visit recording). Note for existing
    // installs: Chrome disables an updated extension until the user approves
    // the newly required permission.
    host_permissions: ["<all_urls>"],
    ...(browser === "chrome" ? { key: CHROME_PUBLIC_KEY } : {}),
    browser_specific_settings: {
      // A fixed add-on ID keeps the OAuth redirect URL on extensions.allizom.org
      // the same across every Firefox install. This is not the original ID. AMO
      // burns an ID permanently when its add-on is deleted, and that is what
      // happened to common-notes@commonnotes.net during the first submission
      // attempt in August 2026. Never delete the AMO listing, because the ID dies
      // with it.
      gecko: {
        id: "extension@commonnotes.net",
        // Mozilla's built-in data consent. It has been mandatory for new AMO
        // submissions since November 2025, and Firefox 140 and later show it at
        // install time. Reading notes sends the URL of a covered page to our API.
        // Signing in is optional, and it carries the user's email address together
        // with their credentials and session.
        data_collection_permissions: {
          required: ["browsingActivity"],
          optional: ["authenticationInfo", "personallyIdentifyingInfo"],
        },
      },
    },
  }),
  hooks: {
    "build:manifestGenerated": (_wxt, manifest) => {
      // The generic content script is injected at runtime on origins we do not know
      // in advance, so WXT cannot work out which matches its stylesheet needs. It
      // emits an empty list, and that would stop the shadow-root UI from fetching
      // the stylesheet at all.
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
    // We do not minify, on purpose. Extension code is loaded from disk, so minifying
    // would save no network time. Mozilla also recommends against it. On top of that,
    // minified output is not reproducible across machines. The minifier assigns names
    // from module ids, and those ids contain absolute paths. AMO reviewers rebuild
    // our source and expect a byte-identical result, which only works unminified.
    build: { minify: false },
    css: {
      // This rewrites every rem value to px after Tailwind has run. A rem resolves
      // against the host page's own html font size even inside a shadow root,
      // because shadow DOM does not isolate that. YouTube for instance sets the html
      // font size to 10px, which shrinks every rem-based utility to 62.5% of its
      // intended size. Fixing one rem at 16px here makes the overlays render the same
      // on every host page.
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
        // WXT sets process.env.NODE_ENV to the name of the build mode in every
        // bundle, and its per-entrypoint library config overrides a define we set
        // ourselves. So building with `--mode prod-backend` would ship React's
        // development build in every content script. That build is about twice the
        // size and takes development-only code paths. A plugin config hook runs
        // after that merge, and it runs inside WXT's child builds too, which is why
        // the fix lives here. The dev server keeps the development runtime, because
        // react-refresh needs it.
        name: "cn-force-prod-react",
        config(config: { define?: Record<string, unknown> }, { command }: { command: string }) {
          if (command !== "build") return;
          (config.define ??= {})["process.env.NODE_ENV"] = JSON.stringify("production");
          // We also change the real process environment. Vite's isProduction flag
          // follows process.env.NODE_ENV, which WXT set to the mode name. That flag
          // decides whether plugin-react uses the production JSX transform. The
          // development transform writes _jsxFileName variables holding absolute
          // paths into the output.
          process.env.NODE_ENV = "production";
        },
      },
      {
        // Rolldown's unminified output labels each module with a //#region comment
        // that carries the module's id, and WXT's virtual entrypoint ids contain the
        // repo's absolute path. We strip that machine-specific prefix, so a rebuild
        // from any directory produces byte-identical files. AMO reviewers diff their
        // own rebuild against the files we submitted.
        name: "cn-path-independent-output",
        renderChunk(code: string) {
          return code.includes(repoRoot) ? code.split(repoRoot).join("") : null;
        },
      },
      {
        // The same guard as in everything-web/vite.config.ts. A build without the
        // Supabase environment variables inlines `undefined`, which turns the
        // module-scope check in everything-shared/supabase.ts into a throw that
        // always fires. We fail the build loudly instead. In dev the throw shows up
        // at runtime, which is good enough.
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
