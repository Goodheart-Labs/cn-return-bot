import type { Meta, StoryObj } from "@storybook/react-vite";
import { Canon } from "./Canon";
import { ClaimAndProof } from "./ClaimAndProof";
import { Sidenotes } from "./Sidenotes";
import { SourcedFigures } from "./SourcedFigures";

/* Four candidate looks for the homepage, built from Jim's sketch with the same
 * real notes and numbers. One of them becomes the site's design; the others
 * are deleted once the choice is made. */
const meta = {
  title: "Directions/Homepage",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

export const A_SourcedFigures: Story = { name: "A. Sourced figures", render: () => <SourcedFigures /> };
export const B_Sidenotes: Story = { name: "B. Margin notes", render: () => <Sidenotes /> };
export const C_ClaimAndProof: Story = { name: "C. Claim and proof", render: () => <ClaimAndProof /> };
export const D_Canon: Story = { name: "D. Standard extension page", render: () => <Canon /> };
