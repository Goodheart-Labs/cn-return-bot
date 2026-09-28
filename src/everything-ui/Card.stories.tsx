import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./Card";

const meta = { title: "Design system/Card", component: Card } satisfies Meta<typeof Card>;
export default meta;

export const Elevations: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-6 bg-canvas p-6">
      <Card className="w-64 p-4 text-sm text-fg">A flat card sits in the page, with a border.</Card>
      <Card elevation="floating" className="w-64 p-4 text-sm text-fg">A floating card also casts a shadow: popovers, menus and modals.</Card>
    </div>
  ),
};
