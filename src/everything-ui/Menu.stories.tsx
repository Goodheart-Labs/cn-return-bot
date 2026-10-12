import type { Meta, StoryObj } from "@storybook/react-vite";
import { PencilIcon, TrashIcon } from "./icons";
import { Menu, MenuItem } from "./Menu";

const meta = { title: "Design system/Menu" } satisfies Meta;
export default meta;

export const Rows: StoryObj = {
  render: () => (
    <Menu>
      <MenuItem onClick={() => {}} icon={<PencilIcon size={16} />}>Edit</MenuItem>
      <MenuItem onClick={() => {}} selected>The current choice</MenuItem>
      <MenuItem onClick={() => {}} icon={<TrashIcon size={16} />} danger>Delete</MenuItem>
    </Menu>
  ),
};
