import * as path from "path";
import type { Config } from "tailwindcss";
import { cnPreset } from "../../../everything-ui/tailwind.preset";

export default {
  presets: [cnPreset],
  content: [
    path.resolve(__dirname, "src/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../../../everything-ui/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../../../everything-features/**/*.{ts,tsx}"),
    path.resolve(__dirname, "../../../dashboard-shared/LinkifiedText.tsx"),
  ],
} satisfies Config;
