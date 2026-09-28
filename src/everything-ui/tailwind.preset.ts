import type { Config } from "tailwindcss";

/** The semantic colour names of tokens.css, and the only colours Tailwind
 *  knows in the Common Notes apps. Tailwind's own palette is left out on
 *  purpose: a class such as `bg-blue-600` generates no CSS here, so a raw
 *  colour cannot slip past the design system. */
export const CN_COLORS = {
  transparent: "transparent",
  current: "currentColor",
  black: "#000",
  white: "#fff",
  "canvas": "var(--cn-canvas)",
  "surface": "var(--cn-surface)",
  "surface-muted": "var(--cn-surface-muted)",
  "surface-hover": "var(--cn-surface-hover)",
  "fg": "var(--cn-fg)",
  "fg-secondary": "var(--cn-fg-secondary)",
  "fg-muted": "var(--cn-fg-muted)",
  "fg-subtle": "var(--cn-fg-subtle)",
  "line": "var(--cn-line)",
  "line-strong": "var(--cn-line-strong)",
  "primary": "var(--cn-primary)",
  "primary-hover": "var(--cn-primary-hover)",
  "on-primary": "var(--cn-on-primary)",
  "link": "var(--cn-link)",
  "focus": "var(--cn-focus)",
  "focus-halo": "var(--cn-focus-halo)",
  "tint": "var(--cn-tint)",
  "tint-line": "var(--cn-tint-line)",
  "inverse": "var(--cn-inverse)",
  "on-inverse": "var(--cn-on-inverse)",
  "on-inverse-muted": "var(--cn-on-inverse-muted)",
  "on-inverse-link": "var(--cn-on-inverse-link)",
  "inverse-line": "var(--cn-inverse-line)",
  "positive": "var(--cn-positive)",
  "positive-soft": "var(--cn-positive-soft)",
  "positive-selected": "var(--cn-positive-selected)",
  "positive-selected-fg": "var(--cn-positive-selected-fg)",
  "positive-line": "var(--cn-positive-line)",
  "positive-solid": "var(--cn-positive-solid)",
  "caution": "var(--cn-caution)",
  "caution-soft": "var(--cn-caution-soft)",
  "caution-selected": "var(--cn-caution-selected)",
  "caution-selected-fg": "var(--cn-caution-selected-fg)",
  "caution-line": "var(--cn-caution-line)",
  "caution-solid": "var(--cn-caution-solid)",
  "negative": "var(--cn-negative)",
  "negative-soft": "var(--cn-negative-soft)",
  "negative-selected": "var(--cn-negative-selected)",
  "negative-selected-fg": "var(--cn-negative-selected-fg)",
  "negative-line": "var(--cn-negative-line)",
  "negative-solid": "var(--cn-negative-solid)",
};

/** The text sizes, each with its line height, read from tokens.css. */
const TEXT_SIZES = ["2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "display"] as const;

/** The shared Tailwind preset of the website and the extension. A preset is a
 *  Tailwind config that other configs build on. Both apps list it under
 *  `presets` and add only what is theirs, such as where to look for class
 *  names. Every value points at a variable in tokens.css, so the design can
 *  change in that one file.
 *
 *  Dark mode follows a `.dark` class. The website sets it on <html>, and the
 *  extension sets it on each shadow root's container to follow the host
 *  page. Colours need no dark: variants, because the tokens swap by
 *  themselves. */
export const cnPreset = {
  darkMode: "class",
  content: [],
  theme: {
    colors: CN_COLORS,
    // A bare `border` or `ring` class takes these defaults.
    borderColor: { ...CN_COLORS, DEFAULT: "var(--cn-line)" },
    ringColor: { ...CN_COLORS, DEFAULT: "var(--cn-focus)" },
    fontFamily: { sans: "var(--cn-font-sans)", display: "var(--cn-font-display)" },
    fontSize: Object.fromEntries(
      TEXT_SIZES.map((size) => [size, [`var(--cn-text-${size})`, { lineHeight: `var(--cn-leading-${size})` }]]),
    ),
    borderRadius: {
      none: "0",
      control: "var(--cn-radius-control)",
      card: "var(--cn-radius-card)",
      full: "9999px",
    },
    boxShadow: {
      none: "none",
      raised: "var(--cn-shadow-raised)",
      floating: "var(--cn-shadow-floating)",
    },
  },
} satisfies Config;
