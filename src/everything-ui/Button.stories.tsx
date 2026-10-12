import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, buttonVariants } from "./Button";
import { IconButton } from "./IconButton";
import { CloseIcon, MoreIcon } from "./icons";

const meta = {
  title: "Design system/Button",
  component: Button,
  args: { children: "Send code", variant: "primary", disabled: false },
  argTypes: { variant: { control: "inline-radio", options: ["primary", "secondary", "link", "quiet"] } },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllVariants: Story = {
  name: "All variants",
  render: () => (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="link">Link</Button>
      <Button variant="quiet">Quiet</Button>
      <Button disabled>Disabled</Button>
      <a href="https://commonnotes.net" className={buttonVariants({ variant: "secondary" })}>A link styled as a button</a>
      <IconButton label="Close" onClick={() => {}}><CloseIcon size={14} /></IconButton>
      <IconButton label="More actions" onClick={() => {}}><MoreIcon size={16} /></IconButton>
    </div>
  ),
};
