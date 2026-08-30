import path from "node:path";
import type { Config } from "tailwindcss";

// The content globs are absolute so they hold whatever directory Tailwind is
// invoked from. The shared components in everything-web and dashboard-shared
// are scanned too, so their utility classes end up in the shadow-root
// stylesheet.
export default {
  // The extension follows the host page's theme. The mount code toggles a
  // `.dark` class on each shadow root's container, and utils/pageTheme.ts
  // decides light or dark from the page's rendered colors. The web apps also
  // pin darkMode to "class" and never set `.dark`, so the shared dark:
  // variants stay inert there.
  darkMode: "class",
  content: [
    path.resolve(__dirname, "entrypoints/**/*.{ts,tsx}"),
    path.resolve(__dirname, "components/**/*.{ts,tsx}"),
    path.resolve(__dirname, "utils/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-shared/**/*.ts"),
    path.resolve(__dirname, "../everything-web/src/components/**/*.tsx"),
    path.resolve(__dirname, "../dashboard-shared/**/*.tsx"),
  ],
} satisfies Config;
