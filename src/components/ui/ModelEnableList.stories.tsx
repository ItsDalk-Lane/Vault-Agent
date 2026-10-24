import { ModelEnableList, type ModelEnableGroup } from "@/components/ui/ModelEnableList";
import type { ModelCapability } from "@/constants";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

type ModelEnableListProps = React.ComponentProps<typeof ModelEnableList>;

const LONG_GROUP: ModelEnableGroup = {
  key: "byok",
  label: "OpenAI",
  badge: "BYOK",
  rows: Array.from({ length: 18 }, (_, i) => ({
    id: `openai/model-${i}`,
    label: `gpt-nova-${i}`,
    enabled: i < 3,
  })),
};

const LOCAL_GROUP: ModelEnableGroup = {
  key: "local",
  label: "LM Studio",
  destination: { kind: "local", label: "This computer" },
  rows: [
    {
      id: "local/qwen",
      label: "Qwen",
      enabled: true,
      capabilities: ["vision" as ModelCapability],
    },
    { id: "local/deepseek", label: "DeepSeek", enabled: true, capabilities: [] },
    { id: "local/glm", label: "GLM", enabled: false, capabilities: [] },
  ],
};

const CLOUD_GROUP: ModelEnableGroup = {
  key: "cloud",
  label: "Anthropic",
  rows: [{ id: "anthropic/sonnet", label: "Claude Sonnet", enabled: true }],
};

const Controlled: React.FC<{ groups: ModelEnableGroup[]; defaultOpenGroupKey?: string }> = ({
  groups,
  defaultOpenGroupKey,
}) => {
  const [query, setQuery] = React.useState("");
  return (
    <ModelEnableList
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      onToggle={() => undefined}
      defaultOpenGroupKey={defaultOpenGroupKey}
    />
  );
};

const meta = {
  title: "Agent Mode/Model Enable List",
  component: ModelEnableList,
  args: {
    groups: [],
    query: "",
    onQueryChange: () => undefined,
    onToggle: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ModelEnableListProps>;
export default meta;

export const OverflowingCatalog: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[LOCAL_GROUP, CLOUD_GROUP, LONG_GROUP]} />,
};

export const ShortCatalog: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[LOCAL_GROUP, CLOUD_GROUP]} />,
};

export const CollapsedWithSelections: StoryObj<ModelEnableListProps> = {
  render: () => (
    <Controlled
      groups={[
        LOCAL_GROUP,
        CLOUD_GROUP,
        LONG_GROUP,
        {
          ...LONG_GROUP,
          key: "none",
          label: "Groq",
          rows: LONG_GROUP.rows.map((row) => ({ ...row, enabled: false })),
        },
      ]}
      defaultOpenGroupKey={LOCAL_GROUP.key}
    />
  ),
};

export const Empty: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[]} />,
};

export const Grouped: StoryObj<ModelEnableListProps> = {
  args: {
    groups: [
      {
        key: "byok:openrouter",
        label: "OpenRouter",
        badge: "BYOK",
        rows: [
          { id: "or-1", label: "google/gemini-3.5-flash", enabled: true },
          { id: "or-2", label: "qwen3-30b-a3b-thinking-2507", enabled: false },
        ],
      },
    ],
  },
};

export const ConfiguredModels: StoryObj<ModelEnableListProps> = {
  args: {
    groups: [
      {
        key: "byok:anthropic",
        label: "Anthropic",
        rows: [
          { id: "saved-claude", label: "Claude Sonnet", enabled: true },
          { id: "saved-haiku", label: "Claude Haiku", enabled: false },
        ],
      },
      {
        key: "byok:google",
        label: "Google",
        rows: [{ id: "saved-gemini", label: "Gemini", enabled: true }],
      },
    ],
    defaultOpenGroupKey: "byok:anthropic",
  },
};
