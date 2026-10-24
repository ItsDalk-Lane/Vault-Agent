import type { Meta, StoryObj } from "@/lib/story";
import { AddProviderContent, type AddProviderContentProps } from "./AddProviderDialog";

const meta = {
  title: "Model Management/Add Provider",
  component: AddProviderContent,
  parameters: { gallery: { host: "modal", layout: "padded" } },
  args: {
    catalogProviders: [
      { id: "anthropic", displayName: "Anthropic", npm: "@ai-sdk/anthropic", models: {} },
      { id: "openai", displayName: "OpenAI", npm: "@ai-sdk/openai", models: {} },
      { id: "google", displayName: "Google", npm: "@ai-sdk/google", models: {} },
      { id: "groq", displayName: "Groq", npm: "@ai-sdk/groq", models: {} },
      {
        id: "unsupported",
        displayName: "Unavailable Provider",
        npm: "unclassified-package",
        models: {},
      },
    ],
    localTemplates: [
      {
        id: "local",
        displayName: "Local endpoint",
        providerType: "openai-compatible",
        defaultBaseUrl: "http://localhost:1234/v1",
        requiresApiKey: false,
        modelInputHint: "model-id",
      },
    ],
    customTemplate: {
      id: "custom",
      displayName: "Custom endpoint",
      providerType: "openai-compatible",
      requiresApiKey: true,
      modelInputHint: "model-id",
    },
    onPick: () => {},
  },
} satisfies Meta<AddProviderContentProps>;
export default meta;

export const AvailableProviders: StoryObj<AddProviderContentProps> = {};
export const EmptyCatalog: StoryObj<AddProviderContentProps> = {
  args: { catalogProviders: [], localTemplates: [] },
};
