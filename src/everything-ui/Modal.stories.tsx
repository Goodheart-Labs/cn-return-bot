import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { Modal } from "./Modal";

const meta = { title: "Design system/Modal" } satisfies Meta;
export default meta;

function ModalDemo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open the modal</Button>
      {open && (
        <Modal title="Write a note" onClose={() => setOpen(false)}>
          <p className="text-sm text-fg-secondary">Escape, the close button and a click on the dimmed page all close it.</p>
        </Modal>
      )}
    </>
  );
}

export const Default: StoryObj = { render: () => <ModalDemo /> };
