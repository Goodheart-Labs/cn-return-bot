import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SegmentedControl } from "./SegmentedControl";

const meta = { title: "Design system/SegmentedControl" } satisfies Meta;
export default meta;

const OPTIONS = [
  { id: "first", label: "First" },
  { id: "second", label: "Second" },
  { id: "third", label: "Third" },
] as const;

export const ThreeOptions: StoryObj = {
  render: function Render() {
    const [value, setValue] = useState<(typeof OPTIONS)[number]["id"]>("first");
    return <SegmentedControl label="Example" options={OPTIONS} value={value} onChange={setValue} />;
  },
};
