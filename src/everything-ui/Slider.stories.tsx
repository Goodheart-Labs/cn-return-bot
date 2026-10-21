import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "./Slider";

const meta = { title: "Design system/Slider" } satisfies Meta;
export default meta;

export const Minimum: StoryObj = {
  render: function Render() {
    const [value, setValue] = useState(5);
    return (
      <div className="w-64">
        <Slider label="Views" value={value} max={40} onChange={setValue} formatValue={(v) => `${v}+`} />
      </div>
    );
  },
};
