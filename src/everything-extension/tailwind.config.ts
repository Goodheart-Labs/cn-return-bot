import path from "node:path";
import type { Config } from "tailwindcss";
import { cnPreset } from "../everything-ui/tailwind.preset";

// The extension's Tailwind build, compiled into each shadow root's
// stylesheet. Every design value comes from the shared preset. The content
// globs are absolute so they hold whatever directory Tailwind runs from.
export default {
  presets: [cnPreset],
  content: [
    path.resolve(__dirname, "entrypoints/**/*.{ts,tsx}"),
    path.resolve(__dirname, "components/**/*.{ts,tsx}"),
    path.resolve(__dirname, "utils/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-ui/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../everything-features/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../dashboard-shared/LinkifiedText.tsx"),
  ],
} satisfies Config;
