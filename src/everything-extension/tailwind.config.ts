import path from "node:path";
import type { Config } from "tailwindcss";

// Content globs are absolute so they hold regardless of the cwd Tailwind is
// invoked from. Shared components (everything-web, dashboard-shared) are
// scanned so their utility classes compile into the shadow-root stylesheet.
export default {
  // The extension follows the HOST PAGE's theme: the mount code toggles a
  // `.dark` class on each shadow root's container (utils/pageTheme.ts decides
  // from the page's rendered colors). The web apps also pin darkMode to
  // "class" and never set `.dark`, so the shared dark: variants stay inert
  // there.
  darkMode: "class",
  content: [
    path.resolve(__dirname, "entrypoints/**/*.{ts,tsx}"),
    path.resolve(__dirname, "components/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-web/src/components/**/*.tsx"),
    path.resolve(__dirname, "../dashboard-shared/**/*.tsx"),
  ],
} satisfies Config;
