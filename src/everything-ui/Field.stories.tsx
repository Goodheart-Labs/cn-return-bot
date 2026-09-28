import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox, Input, Textarea } from "./Field";

const meta = { title: "Design system/Fields" } satisfies Meta;
export default meta;

function Fields() {
  const [text, setText] = useState("This text area grows as you type into it.");
  const [checked, setChecked] = useState(true);
  return (
    <div className="max-w-md space-y-4">
      <Input placeholder="you@example.com" className="w-full" />
      <Textarea autoGrow rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <Checkbox checked={checked} onChange={setChecked} className="text-sm text-fg-secondary">
        Post under my name
      </Checkbox>
    </div>
  );
}

export const All: StoryObj = { render: () => <Fields /> };
