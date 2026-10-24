import { localData } from "./en/localData";
import { localData as zhLocalData } from "./zh-cn/localData";
import { agentChatUi } from "./en/agentChatUi";
import { agentInfraUi } from "./en/agentInfraUi";
import { settingsUi } from "./en/settingsUi";
import { sharedUi } from "./en/sharedUi";
import { en as shell } from "./en/shell";
import { agentChatUi as zhAgentChatUi } from "./zh-cn/agentChatUi";
import { agentInfraUi as zhAgentInfraUi } from "./zh-cn/agentInfraUi";
import { settingsUi as zhSettingsUi } from "./zh-cn/settingsUi";
import { sharedUi as zhSharedUi } from "./zh-cn/sharedUi";
import { zhCn as zhShell } from "./zh-cn/shell";

export const en = {
  ...shell,
  ...localData,
  ...settingsUi,
  ...agentChatUi,
  ...sharedUi,
  ...agentInfraUi,
} as const;

export type MessageKey = keyof typeof en;

export const zhCn: Record<MessageKey, string> = {
  ...zhShell,
  ...zhLocalData,
  ...zhSettingsUi,
  ...zhAgentChatUi,
  ...zhSharedUi,
  ...zhAgentInfraUi,
};
