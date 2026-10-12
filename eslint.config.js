import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

/* ESLint checks the Common Notes frontend: the website, the extension and the
 * three shared layers they are built from. The rest of the repo (the X bot,
 * the pipeline, the dashboards) is not linted yet.
 *
 * Besides the usual TypeScript, React Hooks and accessibility rules, this file
 * enforces which layer may import which. The layers, from the bottom up:
 *   @cn/core      data access, types and scoring. No React components.
 *   @cn/ui        the design system. Knows nothing about notes.
 *   @cn/features  the pieces both apps show, built from the two layers below.
 * The two apps sit on top and never import from each other. */

const COMMON_NOTES = [
  "src/everything-core/**/*.{ts,tsx}",
  "src/everything-ui/**/*.{ts,tsx}",
  "src/everything-features/**/*.{ts,tsx}",
  "src/everything-web/src/**/*.{ts,tsx}",
  "src/everything-extension/{components,entrypoints,utils}/**/*.{ts,tsx}",
  "src/everything-storybook/**/*.{ts,tsx}",
  "src/**/*.stories.tsx",
];

/** Reaching another layer by a relative path hides the dependency, so the
 *  layers are only ever imported through their alias. */
const RELATIVE_LAYER_IMPORTS = [
  { group: ["**/everything-core/**"], message: "Import the core layer as @cn/core/..." },
  { group: ["**/everything-ui/**"], message: "Import the design system as @cn/ui/..." },
  { group: ["**/everything-features/**"], message: "Import shared features as @cn/features/..." },
];
/** Only the core layer talks to the database. Everything above it calls a core
 *  function, so a component can never fetch data behind the data layer's
 *  back. */
const DATABASE_CLIENT = {
  group: ["@cn/core/supabase", "@supabase/supabase-js"],
  // Importing a type such as Session talks to nobody.
  allowTypeImports: true,
  message: "Only @cn/core talks to Supabase. Call a function from @cn/core instead.",
};
/** Only stories may use the Storybook fixtures and decorators. */
const STORYBOOK = { group: ["**/everything-storybook/**"], message: "Only *.stories.tsx files may import from Storybook." };
const APPS = [
  { group: ["**/everything-web/**"], message: "Shared code must not import from the website." },
  { group: ["**/everything-extension/**"], message: "Shared code must not import from the extension." },
];

const OVERLAY_UI_MESSAGE = "Mount extension UI with createOverlayUi from utils/overlayUi.ts. It stops typed keys from reaching the host page's shortcuts.";

/** One flat-config block that restricts what the files in `files` may import. */
function layer(files, patterns, ignores = []) {
  return {
    files,
    ignores,
    rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: [...RELATIVE_LAYER_IMPORTS, ...patterns] }] },
  };
}

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.output/**", "**/.wxt/**", "**/dist/**", "storybook-static/**"] },
  {
    files: COMMON_NOTES,
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Every autoFocus in this code moves focus into something the reader
      // just opened, such as a menu or a composer. That is what keyboard users
      // expect, so the rule's worry about focus jumping on page load does not
      // apply.
      "jsx-a11y/no-autofocus": "off",
      // An argument or a destructured field we deliberately ignore starts with
      // an underscore.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  layer(["src/everything-core/**/*.{ts,tsx}"], [
    STORYBOOK,
    { group: ["@cn/ui/*", "@cn/features/*"], message: "The core layer sits below the design system and the features." },
    { group: ["react", "react-dom", "react-dom/*"], message: "The core layer holds no React code. Hooks belong in @cn/features." },
    { group: ["**/dashboard-shared/**"], message: "The core layer does not depend on the X dashboards." },
    ...APPS,
  ]),
  layer(["src/everything-ui/**/*.{ts,tsx}"], [
    STORYBOOK,
    { group: ["@cn/core/*", "@cn/features/*"], message: "The design system knows nothing about notes or data." },
    { group: ["**/dashboard-shared/**"], message: "The design system does not depend on the X dashboards." },
    ...APPS,
  ]),
  layer(["src/everything-features/**/*.{ts,tsx}"], [STORYBOOK, DATABASE_CLIENT, ...APPS]),
  layer(["src/everything-web/src/**/*.{ts,tsx}"], [STORYBOOK, DATABASE_CLIENT, APPS[1]]),
  layer(["src/everything-extension/{components,entrypoints,utils}/**/*.{ts,tsx}"], [STORYBOOK, DATABASE_CLIENT, APPS[0]]),
  // Every piece of extension UI in a host page mounts through createOverlayUi,
  // which keeps typed keys from triggering the page's shortcuts. WXT's own
  // createShadowRootUi skips that, so it may not be imported, nor used through
  // WXT's auto-import, anywhere else.
  {
    files: ["src/everything-extension/{components,entrypoints,utils}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "#imports", importNames: ["createShadowRootUi"], message: OVERLAY_UI_MESSAGE }] }],
      "no-restricted-globals": ["error", { name: "createShadowRootUi", message: OVERLAY_UI_MESSAGE }],
    },
  },
  // A story may reach into Storybook's fixtures, and Storybook may render any
  // layer and either app. The database stays out of reach for both.
  // Storybook's Tailwind config is loaded by Tailwind itself, which knows no
  // aliases, so it reaches the preset by path.
  layer(["src/**/*.stories.tsx", "src/everything-storybook/**/*.{ts,tsx}"], [DATABASE_CLIENT], ["src/everything-storybook/tailwind.config.ts"]),
);
