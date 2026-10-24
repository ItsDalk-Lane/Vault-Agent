import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type ModelSelectorProps = ComponentProps<typeof ModelSelector>;

const OWN_MODELS: ModelSelectorEntry[] = [
  {
    name: "qwen",
    provider: "lmstudio",
    displayName: "Qwen",
    enabled: true,
    _group: "LM Studio",
  },
  {
    name: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "anthropic/claude-sonnet-4-6",
    enabled: true,
    _group: "Anthropic",
  },
];

const meta = {
  title: "UI/Model Selector",
  component: ModelSelector,
  args: {
    value: "qwen|lmstudio",
    onChange: () => undefined,
    models: OWN_MODELS,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ModelSelectorProps>;
export default meta;

export const Configured: StoryObj<ModelSelectorProps> = {};

export const MixedDestinations: StoryObj<ModelSelectorProps> = {
  args: {
    models: OWN_MODELS,
  },
};

export const EmptySelection: StoryObj<ModelSelectorProps> = {
  args: {
    value: "",
    models: OWN_MODELS,
  },
};

export const CommandNeedsSelection: StoryObj<ModelSelectorProps> = { args: { value: "" } };
