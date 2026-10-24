import type { VaultAgentSettings } from "@/settings/model";
import { SettingsMigration } from "@/agentMode/sdk/pi/storage/SettingsMigration";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { sha256 } from "@/utils/hash";

export async function migratePiSettingsAtStartup(options: {
  readonly settings: VaultAgentSettings;
  readonly backupDirectory: string;
  readonly readSessionIndex?: () => Promise<string | null>;
  readonly saveSettings: (settings: VaultAgentSettings) => Promise<void>;
}): Promise<VaultAgentSettings> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  let settings = options.settings;
  const migration = new SettingsMigration({
    ports: {
      readSettings: async () => settings as unknown as Record<string, unknown>,
      writeSettings: async (next) => {
        const migrated = next as unknown as VaultAgentSettings;
        await options.saveSettings(migrated);
        settings = migrated;
      },
      writeBackup: async (input) => {
        const index = await options.readSessionIndex?.();
        const content = JSON.stringify({
          ...input,
          sessionIndex: index ? (JSON.parse(index) as unknown) : null,
        });
        await fs.mkdir(options.backupDirectory, { recursive: true, mode: 0o700 });
        const target = path.join(
          options.backupDirectory,
          `schema-${input.schemaVersion}-${sha256(content).slice(0, 16)}.json`
        );
        try {
          await fs.writeFile(target, content, { flag: "wx", mode: 0o600 });
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "EEXIST" ||
            (await fs.readFile(target, "utf8")) !== content
          )
            throw error;
        }
        return { path: target };
      },
    },
  });
  const result = await migration.migrate();
  if (result.status === "failed")
    throw new Error(
      result.error ?? "Pi settings migration failed; the original settings were preserved."
    );
  if (result.status === "future_version")
    throw new Error(
      "These settings were written by a newer Vault Agent version and remain read-only."
    );
  return settings;
}
