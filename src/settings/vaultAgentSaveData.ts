import type { VaultAgentSettings } from "@/settings/model";
import type { App } from "obsidian";

export function getVaultAgentSaveData(app: App): (data: VaultAgentSettings) => Promise<void> {
  return async (data: VaultAgentSettings) => {
    const { plugins } = app as unknown as {
      plugins: {
        getPlugin: (id: string) => { saveData: (data: VaultAgentSettings) => Promise<void> } | null;
      };
    };
    const vaultAgentPlugin = plugins.getPlugin("vault-agent");
    if (!vaultAgentPlugin) throw new Error("Vault Agent plugin not found");
    await vaultAgentPlugin.saveData(data);
  };
}
