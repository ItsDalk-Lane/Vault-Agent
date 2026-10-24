import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import {
  ConfigureProviderEditor,
  type ConfigureProviderEditorProps,
} from "./ConfigureProviderEditor";
import { createModelDraft } from "./providerDraft";

const base: ConfigureProviderEditorProps = {
  initialDraft: {
    displayName: "Example provider",
    providerType: "openai-compatible",
    baseUrl: "https://models.example/v1",
    apiKey: "example-key",
    extras: {},
    enabled: true,
    models: [],
  },
  requiresApiKey: true,
  defaultBaseUrl: () => "https://models.example/v1",
  catalogModels: [
    {
      id: "example-vision",
      displayName: "Example vision",
      modalities: { input: ["text", "image"] },
      capabilities: { structuredOutput: true },
      reasoningEfforts: ["low", "high"],
    },
    { id: "example-reasoning", displayName: "Example reasoning" },
  ],
  onTestModel: async () => {},
  onSave: async () => {},
  onClose: () => {},
};
const meta = {
  title: "Models/Provider configuration",
  component: (props: ConfigureProviderEditorProps) => (
    <div className="tw-h-[70vh] tw-min-h-0 tw-min-w-0">
      <ConfigureProviderEditor {...props} />
    </div>
  ),
  parameters: { gallery: { host: "modal", layout: "fullscreen", modalClass: "tw-max-w-[95vw]" } },
} satisfies Meta<ConfigureProviderEditorProps>;
export default meta;
export const Empty: StoryObj<ConfigureProviderEditorProps> = { args: base };
export const Configured: StoryObj<ConfigureProviderEditorProps> = {
  args: {
    ...base,
    editing: true,
    initialDraft: {
      ...base.initialDraft,
      models: [
        createModelDraft(
          {
            id: "example-vision",
            displayName: "Example vision",
            limits: { context: 1000000, output: 384000 },
            modalities: { input: ["text", "image"] },
            capabilities: { structuredOutput: true, midConversationSystemMessages: true },
            reasoningEfforts: ["low", "high"],
          },
          true,
          true
        ),
        createModelDraft({ id: "example-reasoning", displayName: "Example reasoning" }),
      ],
    },
  },
};
export const Disabled: StoryObj<ConfigureProviderEditorProps> = {
  args: {
    ...base,
    editing: true,
    initialDraft: {
      ...base.initialDraft,
      enabled: false,
      models: [
        createModelDraft(
          {
            id: "a-model-with-a-long-name-that-needs-to-wrap-on-small-screens",
            displayName: "Long model",
          },
          false,
          true
        ),
      ],
    },
  },
};
export const NoBuiltinModels: StoryObj<ConfigureProviderEditorProps> = {
  args: { ...base, catalogModels: [] },
};

export const ModelTestError: StoryObj<ConfigureProviderEditorProps> = {
  args: {
    ...Configured.args,
    onTestModel: async () => {
      throw new Error("The model request was rejected by the provider.");
    },
  },
};
export const ModelTestLoading: StoryObj<ConfigureProviderEditorProps> = {
  args: {
    ...Configured.args,
    onTestModel: (_draft, _model, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Model test cancelled", "AbortError")),
          { once: true }
        );
      }),
  },
};

export const GoogleNetworkRequirements: StoryObj<ConfigureProviderEditorProps> = {
  args: {
    ...Configured.args,
    initialDraft: {
      ...base.initialDraft,
      providerType: "google",
      baseUrl: "https://google-gateway.example/v1beta",
      models: [createModelDraft({ id: "gemini-example", displayName: "Gemini example" })],
    },
    onTestModel: async () => {
      throw new Error("Failed to fetch");
    },
  },
};

export const ToolVerificationFailed: StoryObj<ConfigureProviderEditorProps> = {
  args: {
    ...Configured.args,
    onTestModel: async () => {
      throw new Error("连接成功，但模型未能正确读取工具返回的结果。");
    },
  },
};
export const ConnectionOnly: StoryObj<ConfigureProviderEditorProps> = {
  args: {
    ...Configured.args,
    initialDraft: {
      ...base.initialDraft,
      models: [createModelDraft({ id: "text-only", displayName: "Text only", toolCall: false })],
    },
  },
};
