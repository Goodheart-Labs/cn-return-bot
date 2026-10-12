import * as path from "path";
import type { Config } from "tailwindcss";
import { cnPreset } from "../everything-ui/tailwind.preset";

/* The website's Tailwind build. Every design value comes from the shared
 * preset. The website's larger reading scale lives in src/index.css, as an
 * override of the text-size tokens. */
export default {
  presets: [cnPreset],
  content: [
    path.resolve(__dirname, "index.html"),
    path.resolve(__dirname, "src/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-ui/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-features/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../dashboard-shared/LinkifiedText.tsx"),
  ],
} satisfies Config;
