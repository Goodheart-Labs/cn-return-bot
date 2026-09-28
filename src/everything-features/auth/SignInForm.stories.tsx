import type { Meta, StoryObj } from "@storybook/react-vite";
import { SignInForm } from "./SignInForm";

const meta = {
  title: "Features/Sign-in form",
  component: SignInForm,
  args: { surface: "web", signInWithX: async () => ({}) },
  decorators: [(Story) => <div className="max-w-sm"><Story /></div>],
} satisfies Meta<typeof SignInForm>;
export default meta;

export const Email: StoryObj<typeof meta> = {};
