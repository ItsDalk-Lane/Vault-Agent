import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VaultAgentSettings } from "@/settings/model";
import { migratePiSettingsAtStartup } from "@/agentMode/backends/pi/settingsMigration";

describe("settingsMigration", () => {
  describe("migratePiSettingsAtStartup()", () => {
    it("backs up the original settings and history before activating Pi https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-settings-"));
      try {
        const settings = {
          agentMode: { activeBackend: "codex" },
          providers: {},
          configuredModels: [],
          backends: {},
          apiKey: "secret",
        } as unknown as VaultAgentSettings;
        let writes = 0;
        const migrated = await migratePiSettingsAtStartup({
          settings,
          backupDirectory: directory,
          readSessionIndex: async () => '{"entries":[{"backendId":"codex","sessionId":"old"}]}',
          saveSettings: async () => {
            expect((await fs.readdir(directory)).length).toBe(1);
            writes += 1;
          },
        });
        expect(migrated.agentMode.activeBackend).toBe("pi");
        expect(writes).toBe(1);
        const backup = await fs.readFile(
          path.join(directory, (await fs.readdir(directory))[0]),
          "utf8"
        );
        expect(backup).toContain('"sessionId":"old"');
        expect(backup).not.toContain("secret");
        expect(
          await migratePiSettingsAtStartup({
            settings: migrated,
            backupDirectory: directory,
            saveSettings: async () => {
              writes += 1;
            },
          })
        ).toBe(migrated);
        expect(writes).toBe(1);
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  });
});
