import type { Meta, StoryObj } from "@storybook/react-vite";
import * as icons from "./icons";

const meta = { title: "Design system/Icons" } satisfies Meta;
export default meta;

const ICONS = Object.entries(icons).filter(([name]) => name.endsWith("Icon")) as [string, (props: { size?: number }) => React.ReactNode][];

export const All: StoryObj = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 text-fg">
      {ICONS.map(([name, Icon]) => (
        <div key={name} className="flex items-center gap-2 rounded-control border border-line p-2 text-xs">
          <Icon size={18} />
          {name}
        </div>
      ))}
    </div>
  ),
};
