import type { Meta, StoryObj } from "@/lib/story";
import { PasswordInput } from "./password-input";

const meta = {
  title: "UI/Password input",
  component: PasswordInput,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof PasswordInput>>;
export default meta;
export const Default: StoryObj<React.ComponentProps<typeof PasswordInput>> = {
  args: { value: "example-secret", ariaLabel: "API key" },
};
export const Disabled: StoryObj<React.ComponentProps<typeof PasswordInput>> = {
  args: { value: "example-secret", ariaLabel: "API key", disabled: true },
};
