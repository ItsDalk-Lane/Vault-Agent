import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import { COMMAND_ICONS, COMMAND_IDS, COMMAND_NAMES, CommandId } from "@/constants";
import {
  clearRecordedPromptPayload,
  flushRecordedPromptPayloadToLog,
} from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { logError } from "@/logger";
import { logFileManager } from "@/logFileManager";
import type VaultAgentPlugin from "@/main";
import { Notice } from "obsidian";

function addCommand(plugin: VaultAgentPlugin, id: CommandId, callback: () => void | Promise<void>) {
  plugin.addCommand({
    id,
    name: COMMAND_NAMES[id],
    icon: COMMAND_ICONS[id],
    callback: () => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch((err) => logError(`Command ${id} failed`, err));
      }
    },
  });
}

export function registerCommands(plugin: VaultAgentPlugin) {
  addCommand(plugin, COMMAND_IDS.OPEN_AGENT_CHAT_WINDOW, () => {
    void plugin.activateAgentView();
  });
  addCommand(plugin, COMMAND_IDS.TOGGLE_AGENT_CHAT_WINDOW, () => {
    void plugin.toggleAgentView();
  });
  addCommand(plugin, COMMAND_IDS.NEW_AGENT_CHAT, () => {
    clearRecordedPromptPayload();
    void plugin.newAgentChat();
  });

  addCommand(plugin, COMMAND_IDS.ADD_CUSTOM_COMMAND, async () => {
    const commands = getCachedCustomCommands();
    const newCommand = { ...EMPTY_COMMAND };
    const modal = new CustomCommandSettingsModal(
      plugin.app,
      commands,
      newCommand,
      async (updatedCommand) => {
        await CustomCommandManager.getInstance().createCommand(updatedCommand);
      }
    );
    modal.open();
  });

  addCommand(plugin, COMMAND_IDS.OPEN_LOG_FILE, async () => {
    try {
      await flushRecordedPromptPayloadToLog();
      await logFileManager.openLogFile();
    } catch (error) {
      logError("Error creating Vault Agent log file:", error);
      new Notice("Failed to create Vault Agent log file.");
    }
  });

  addCommand(plugin, COMMAND_IDS.CLEAR_LOG_FILE, async () => {
    try {
      await logFileManager.clear();
      new Notice("Vault Agent log cleared.");
    } catch (error) {
      logError("Error clearing Vault Agent log file:", error);
      new Notice("Failed to clear Vault Agent log file.");
    }
  });
}
