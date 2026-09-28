import type { Meta, StoryObj } from "@storybook/react-vite";
import { chipVariants } from "./Chip";
import { cn } from "./cn";

const meta = { title: "Design system/Chip" } satisfies Meta;
export default meta;

export const Shapes: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <span className={cn(chipVariants(), "border-line-strong text-fg-secondary")}>A pill</span>
      <span className={cn(chipVariants(), "bg-primary border-primary text-on-primary")}>Selected</span>
      <span className={cn(chipVariants(), "border-line text-link")}>With a colour</span>
    </div>
  ),
};
