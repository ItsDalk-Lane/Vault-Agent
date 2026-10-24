import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { ModelManagementProvider } from "@/modelManagement/ui/ModelManagementContext";
import { ByokGlobalTable } from "./ByokGlobalTable";

const api = {
  coordinator: { removeConfiguredModel: async () => undefined },
} as unknown as ModelManagementApi;
const meta = {
  title: "Settings/BYOK/Provider Table",
  component: ByokGlobalTable,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof ByokGlobalTable>>;
export default meta;

export const DisabledProvider: StoryObj<React.ComponentProps<typeof ByokGlobalTable>> = {
  render: (args) => (
    <ModelManagementProvider api={api}>
      <ByokGlobalTable
        groups={[]}
        onConfigure={() => undefined}
        onRemove={() => undefined}
        {...args}
      />
    </ModelManagementProvider>
  ),
  args: {
    groups: [
      {
        provider: {
          providerId: "disabled",
          providerType: "openai-compatible",
          displayName: "Example provider",
          origin: { kind: "byok" },
          addedAt: 0,
          enabled: false,
          requiresApiKey: false,
        },
        models: [],
      },
    ],
    onConfigure: () => undefined,
    onRemove: () => undefined,
  },
};
