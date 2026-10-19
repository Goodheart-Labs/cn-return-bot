import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SESSION } from "../../everything-storybook/fixtures";
import { Composer } from "./Composer";

const meta = { title: "Features/Composer" } satisfies Meta;
export default meta;

function ComposerDemo({ error }: { error: string | null }) {
  const [text, setText] = useState("Rents fell 2% last year according to the city's rent index.");
  return (
    <div className="max-w-xl">
      <Composer
        session={SESSION}
        text={text}
        onTextChange={setText}
        placeholder="Write a clearer or better-sourced version"
        rows={3}
        submitLabel="Post note"
        onSubmit={() => {}}
        onCancel={() => {}}
        pending={false}
        error={error}
      />
    </div>
  );
}

export const Writing: StoryObj = { render: () => <ComposerDemo error={null} /> };
export const Failed: StoryObj = { render: () => <ComposerDemo error="Could not post. Try again" /> };
