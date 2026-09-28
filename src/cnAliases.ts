import * as path from "path";

/** The import aliases of the Common Notes code, shared by every bundler that
 *  builds it: the website's Vite config, the extension's WXT config and
 *  Storybook. An alias maps a short prefix such as `@cn/ui` to a folder, so
 *  a file imports `@cn/ui/Button` instead of counting `../` steps.
 *
 *  The layers, from the bottom up:
 *  - `@cn/core` holds the data access, the types and the scoring math. It
 *    knows nothing about React components.
 *  - `@cn/ui` is the design system. It knows nothing about notes.
 *  - `@cn/features` builds the pieces both apps show, such as a note, from
 *    the two layers below.
 *
 *  TypeScript cannot import this file, so tsconfig.json repeats the same
 *  mapping under `paths`. */
export const CN_ALIASES = {
  "@cn/core": path.resolve(__dirname, "everything-core"),
  "@cn/ui": path.resolve(__dirname, "everything-ui"),
  "@cn/features": path.resolve(__dirname, "everything-features"),
};
