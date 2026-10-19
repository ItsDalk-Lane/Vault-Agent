import { getVaultAgentSaveData } from "@/settings/vaultAgentSaveData";
import type { VaultAgentSettings } from "@/settings/model";
import type { App } from "obsidian";

function appWithPlugin(saveData?: (data: VaultAgentSettings) => Promise<void>): App {
  return {
    plugins: {
      getPlugin: (id: string) => (id === "vault-agent" && saveData ? { saveData } : null),
    },
  } as unknown as App;
}

describe("copilotSaveData", () => {
  describe("getVaultAgentSaveData()", () => {
    it("returns a writer that delegates to the loaded plugin's saveData", async () => {
      const pluginSave = jest
        .fn<Promise<void>, [VaultAgentSettings]>()
        .mockResolvedValue(undefined);
      const write = getVaultAgentSaveData(appWithPlugin(pluginSave));
      const data = { vaultAgentFolder: "team/copilot" } as VaultAgentSettings;

      await write(data);

      expect(pluginSave).toHaveBeenCalledWith(data);
    });

    it("throws when the plugin is not loaded", async () => {
      const write = getVaultAgentSaveData(appWithPlugin(undefined));

      await expect(write({} as VaultAgentSettings)).rejects.toThrow("Vault Agent plugin not found");
    });
  });
});
