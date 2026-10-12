import * as path from "path";
import type { Config } from "tailwindcss";
import { cnPreset } from "../everything-ui/tailwind.preset";

/* Storybook's Tailwind build scans both apps, so every component renders with
 * the classes it uses in production. */
export default {
  presets: [cnPreset],
  content: [
    path.resolve(__dirname, "**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-ui/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-features/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-web/src/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-extension/{components,entrypoints,utils,stories}/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../dashboard-shared/LinkifiedText.tsx"),
  ],
} satisfies Config;
