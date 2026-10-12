import type { Meta, StoryObj } from "@storybook/react-vite";
import { eyebrowVariants, Quote } from "./typography";

const meta = { title: "Design system/Typography" } satisfies Meta;
export default meta;

export const Text: StoryObj = {
  render: () => (
    <div className="max-w-xl space-y-4">
      <p className={eyebrowVariants()}>Section label</p>
      <h2 className="text-2xl font-extrabold text-fg">A page title</h2>
      <p className="text-sm text-fg">Body text of a note. It carries the correction itself.</p>
      <p className="text-sm text-fg-secondary">Secondary text, such as a question under a note.</p>
      <p className="text-xs text-fg-muted">Muted text for captions and help.</p>
      <Quote>“Rents in the city fell by 20% last year.”</Quote>
    </div>
  ),
};
