import type { VaultAgentSettingsTabId } from "@/settings/settingsTabs";
import { callMethod, isRecord, readProperty } from "@/utils/obsidianInternals";
import type { App } from "obsidian";

let requestedVaultAgentSettingsTab: VaultAgentSettingsTabId | null = null;

interface ObsidianSettingsController {
  open: () => void;
  openTabById: (id: string) => void;
}

export function openVaultAgentSettings(
  app: App,
  ownerWindow: Window,
  tab: VaultAgentSettingsTabId
): void {
  const settings = (app as unknown as { setting: ObsidianSettingsController }).setting;
  requestedVaultAgentSettingsTab = tab;
  settings.open();
  // Opening settings consumes the request immediately when the plugin is already
  // selected. Otherwise hand off after the modal opens so the settings shell renders only
  // once and no detached React tree is left behind.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  ownerWindow.requestAnimationFrame(() => {
    if (requestedVaultAgentSettingsTab !== null) settings.openTabById("vault-agent");
  });
}

export function openCorePluginSettings(app: App, pluginName: string): void {
  const settings = readProperty(app, "setting");
  callMethod(settings, "open");
  callMethod(settings, "openTabById", "plugins");
  const search = callMethod(
    readProperty(readProperty(settings, "activeTab"), "containerEl"),
    "querySelector",
    'input[type="search"]'
  );
  // Obsidian's settings markup has no public API, so a changed Core plugins tab still opens, just unfiltered.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
  if (!isRecord(search)) return;
  search.value = pluginName;
  callMethod(search, "dispatchEvent", new Event("input"));
}

export function consumeRequestedVaultAgentSettingsTab(): VaultAgentSettingsTabId {
  const requestedTab = requestedVaultAgentSettingsTab ?? "basic";
  requestedVaultAgentSettingsTab = null;
  return requestedTab;
}
