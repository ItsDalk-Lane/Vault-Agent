import type { Meta, StoryObj } from "@/lib/story";
import { AddProviderContent, type AddProviderContentProps } from "./AddProviderDialog";

const meta = {
  title: "Model Management/Add Provider",
  component: AddProviderContent,
  parameters: { gallery: { host: "modal", layout: "padded" } },
  args: {
    catalogProviders: [
      {
        id: "anthropic",
        displayName: "Anthropic",
        providerType: "anthropic",
        defaultBaseUrl: "https://api.anthropic.com",
        models: {},
      },
      {
        id: "openai",
        displayName: "OpenAI",
        providerType: "openai-compatible",
        defaultBaseUrl: "https://api.openai.com/v1",
        models: {},
      },
      {
        id: "google",
        displayName: "Google",
        providerType: "google",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        models: {},
      },
      {
        id: "groq",
        displayName: "Groq",
        providerType: "openai-compatible",
        defaultBaseUrl: "https://api.groq.com/openai/v1",
        models: {},
      },
      {
        id: "unsupported",
        displayName: "Unavailable Provider",
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
