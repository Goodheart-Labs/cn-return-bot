import * as path from "path";
import type { Config } from "tailwindcss";

/* The site's own compiled Tailwind. Dark mode is the same `.dark` class the
 * extension uses, set on <html> by SystemTheme (and pre-paint in index.html),
 * so shared components carry exactly one dark system.
 *
 * The fontSize block bakes in the larger reading scale the site has always
 * shipped (design.css used to rescale these classes under
 * data-fontsize="large"). It is per-app: the extension compiles its own config
 * and keeps the default scale, as it always has. */
export default {
  darkMode: "class",
  content: [
    path.resolve(__dirname, "index.html"),
    path.resolve(__dirname, "src/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-shared/**/*.ts"),
    path.resolve(__dirname, "../dashboard-shared/**/*.tsx"),
  ],
  theme: {
    extend: {
      fontSize: {
        xs: ["0.875rem", "1.25rem"],
        sm: ["1rem", "1.5rem"],
        base: ["1.125rem", "1.75rem"],
        lg: ["1.25rem", "1.75rem"],
        "2xl": ["1.875rem", "2.25rem"],
      },
    },
  },
} satisfies Config;
