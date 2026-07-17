import path from "node:path";
import type { Config } from "tailwindcss";

// Content globs are absolute so they hold regardless of the cwd Tailwind is
// invoked from. Shared components (everything-web, dashboard-shared) are
// scanned so their utility classes compile into the shadow-root stylesheet.
export default {
  content: [
    path.resolve(__dirname, "entrypoints/**/*.{ts,tsx}"),
    path.resolve(__dirname, "components/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-web/src/components/**/*.tsx"),
    path.resolve(__dirname, "../dashboard-shared/**/*.tsx"),
  ],
} satisfies Config;
