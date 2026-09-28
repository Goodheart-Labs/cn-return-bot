import type { Meta, StoryObj } from "@storybook/react-vite";
import { CN_COLORS } from "./tailwind.preset";

/* Every design token, drawn. Switch the theme in the toolbar to see the dark
 * values, and the scale to see the website's larger text sizes. */

const meta = { title: "Design system/Tokens" } satisfies Meta;
export default meta;

const SEMANTIC_COLORS = Object.keys(CN_COLORS).filter((name) => !["transparent", "current", "black", "white"].includes(name));

export const Colours: StoryObj = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
      {SEMANTIC_COLORS.map((name) => (
        <div key={name} className="rounded-control border border-line bg-surface p-2">
          <div className="h-12 rounded-control border border-line" style={{ background: `var(--cn-${name})` }} />
          <p className="mt-2 text-xs font-semibold text-fg">{name}</p>
          <p className="text-2xs text-fg-muted">--cn-{name}</p>
        </div>
      ))}
    </div>
  ),
};

const TEXT_SIZES = ["2xs", "xs", "sm", "base", "lg", "xl", "2xl"] as const;

export const TypeScale: StoryObj = {
  name: "Type scale",
  render: () => (
    <div className="space-y-3 text-fg">
      {TEXT_SIZES.map((size) => (
        <div key={size} className="flex items-baseline gap-4">
          <span className="w-12 shrink-0 text-2xs text-fg-muted">{size}</span>
          <span className={`text-${size}`}>Community Notes on everything you read</span>
        </div>
      ))}
    </div>
  ),
};

export const Shape: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-6 text-xs text-fg-muted">
      {[
        ["rounded-control", "Controls: buttons, fields, note boxes"],
        ["rounded-card", "Cards and popovers"],
        ["rounded-full", "Pills and dots"],
      ].map(([radius, label]) => (
        <div key={radius} className="space-y-2">
          <div className={`h-16 w-28 border border-line-strong bg-surface ${radius}`} />
          <p className="font-semibold text-fg">{radius}</p>
          <p className="w-28">{label}</p>
        </div>
      ))}
      {[
        ["shadow-raised", "Small marks over a page"],
        ["shadow-floating", "Popovers, menus, modals"],
      ].map(([shadow, label]) => (
        <div key={shadow} className="space-y-2">
          <div className={`h-16 w-28 rounded-card bg-surface ${shadow}`} />
          <p className="font-semibold text-fg">{shadow}</p>
          <p className="w-28">{label}</p>
        </div>
      ))}
    </div>
  ),
};
