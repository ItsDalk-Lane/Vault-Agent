import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import type { Meta, StoryObj } from "@/lib/story";
import type React from "react";

type AgentStatusCardProps = React.ComponentProps<typeof AgentStatusCard>;
const meta = {
  title: "Agent Mode/Agent Status Card",
  component: AgentStatusCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentStatusCardProps>;
export default meta;

export const SessionError: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "error",
    summary: "Vault Agent session error",
    message:
      "The model service closed the connection before the response finished. Saved messages remain available. Check the model service and try again.",
    action: { label: "Retry", onClick: () => undefined },
  },
};
export const RecoveryWarning: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "warning",
    message: "The previous task was interrupted. Review its saved state before continuing.",
  },
};
export const ConfigChangedReload: StoryObj<AgentStatusCardProps> = {
  args: {
    layout: "row",
    message: "Vault Agent settings have changed",
    action: { label: "Reload", onClick: () => undefined },
  },
};
export const ConfigChangedReloading: StoryObj<AgentStatusCardProps> = {
  args: {
    layout: "row",
    message: "Vault Agent settings have changed",
    action: { label: "Reloading…", onClick: () => undefined, disabled: true },
  },
};
