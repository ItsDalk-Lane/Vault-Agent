import {
  PI_DEFAULT_ENGINE_ID,
  PI_SETTINGS_SCHEMA_VERSION,
  SettingsMigration,
  redactSecrets,
  type SettingsMigrationPorts,
} from "@/agentMode/sdk/pi/storage/SettingsMigration";

// Settings migration is versioned and monotonic: the non-secret configuration is backed up before any
// write, the write must succeed before the migration counts as done, BYOK keychain references survive,
// agent-origin models are flagged instead of faking subscription credentials as API keys, new sessions
// default to pi while old records keep their backendId, and repeats or retries never duplicate data:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeMigrationPorts implements SettingsMigrationPorts {
  settings: Record<string, unknown>;
  readonly backups: Array<{ schemaVersion: number; payload: Record<string, unknown> }> = [];
  readonly writes: Array<Record<string, unknown>> = [];
  failBackup = false;
  failWrite = false;

  constructor(settings: Record<string, unknown>) {
    this.settings = settings;
  }

  readSettings = async (): Promise<Record<string, unknown>> => this.settings;

  writeSettings = async (next: Record<string, unknown>): Promise<void> => {
    if (this.failWrite) throw new Error("disk full");
    this.writes.push(next);
    this.settings = next;
  };

  writeBackup = async (input: {
    schemaVersion: number;
    payload: Record<string, unknown>;
  }): Promise<{ path: string }> => {
    if (this.failBackup) throw new Error("no space for backup");
    this.backups.push({ ...input });
    return { path: `migration/backup-${input.schemaVersion}.json` };
  };
}

function legacySettings(): Record<string, unknown> {
  return {
    openAIApiKey: "sk-live-secret",
    providers: [
      {
        providerId: "byok-openai",
        providerType: "openai",
        displayName: "OpenAI",
        apiKeyKeychainId: "keychain-openai",
        origin: { kind: "byok", catalogProviderId: "openai" },
        addedAt: 1,
      },
      {
        providerId: "byok-openai",
        providerType: "openai",
        displayName: "OpenAI duplicate",
        origin: { kind: "byok", catalogProviderId: "openai" },
        addedAt: 2,
      },
      {
        providerId: "agent-claude",
        providerType: "anthropic",
        displayName: "Claude subscription",
        requiresApiKey: false,
        extras: { credentialKind: "subscription" },
        origin: { kind: "agent", agentType: "claude" },
        addedAt: 3,
      },
    ],
    configuredModels: [
      {
        configuredModelId: "byok-openai:gpt-4o",
        providerId: "byok-openai",
        info: { displayName: "GPT-4o", id: "gpt-4o" },
        configuredAt: 1,
      },
      {
        configuredModelId: "byok-openai:gpt-4o",
        providerId: "byok-openai",
        info: { displayName: "GPT-4o", id: "gpt-4o" },
        configuredAt: 2,
      },
      {
        configuredModelId: "agent-claude:sonnet",
        providerId: "agent-claude",
        info: { displayName: "Claude Sonnet", id: "sonnet" },
        configuredAt: 3,
      },
    ],
    agentMode: { activeBackend: "claude", byok: {} },
    chatRecords: [
      { chatId: "chat-1", backendId: "claude" },
      { chatId: "chat-2", backendId: "codex" },
    ],
  };
}

function harness(settings = legacySettings()): {
  ports: FakeMigrationPorts;
  migration: SettingsMigration;
} {
  const ports = new FakeMigrationPorts(settings);
  return { ports, migration: new SettingsMigration({ ports }) };
}

describe("SettingsMigration", () => {
  describe("SettingsMigration", () => {
    describe("migrate()", () => {
      it("backs up non-secret configuration with its schema version before writing", async () => {
        const { ports, migration } = harness();

        const result = await migration.migrate();

        expect(result).toMatchObject({
          status: "migrated",
          fromVersion: 0,
          toVersion: PI_SETTINGS_SCHEMA_VERSION,
          backupPath: "migration/backup-0.json",
        });
        expect(ports.backups).toHaveLength(1);
        expect(ports.backups[0]?.schemaVersion).toBe(0);
        expect(JSON.stringify(ports.backups[0]?.payload)).not.toContain("sk-live-secret");
        expect(ports.backups[0]?.payload.openAIApiKey).toBeUndefined();
        expect(ports.writes).toHaveLength(1);
        expect(ports.writes[0]?.openAIApiKey).toBe("sk-live-secret");
        expect(ports.writes[0]?.settingsSchemaVersion).toBe(PI_SETTINGS_SCHEMA_VERSION);
      });

      it("removes duplicate providers and models without touching the surviving keychain reference", async () => {
        const { ports, migration } = harness();

        await migration.migrate();

        const providers = ports.writes[0]?.providers as Record<string, Record<string, unknown>>;
        expect(Object.keys(providers)).toEqual(["byok-openai", "agent-claude"]);
        expect(providers["byok-openai"]?.apiKeyKeychainId).toBe("keychain-openai");
        const models = ports.writes[0]?.configuredModels as Array<Record<string, unknown>>;
        expect(models.map((model) => model.configuredModelId)).toEqual([
          "byok-openai:gpt-4o",
          "agent-claude:sonnet",
        ]);
      });

      it("flags an agent-origin model while keeping its label and never inventing an API key", async () => {
        const { ports, migration } = harness();

        await migration.migrate();

        const models = ports.writes[0]?.configuredModels as Array<Record<string, unknown>>;
        const agentModel = models.find(
          (model) => model.configuredModelId === "agent-claude:sonnet"
        );
        expect(agentModel?.needsReconfiguration).toBe(true);
        expect(agentModel).not.toHaveProperty("apiKey");
        expect((agentModel?.info as Record<string, unknown>).displayName).toBe("Claude Sonnet");
        const providers = ports.writes[0]?.providers as Record<string, Record<string, unknown>>;
        expect(providers["agent-claude"]).toMatchObject({
          requiresApiKey: false,
          extras: { credentialKind: "subscription" },
        });
        expect(providers["agent-claude"]).not.toHaveProperty("apiKeyKeychainId");
      });

      it("defaults new sessions to pi while old chat records keep their backendId", async () => {
        const { ports, migration } = harness();
        const before = legacySettings().chatRecords;

        await migration.migrate();

        expect((ports.writes[0]?.agentMode as Record<string, unknown>).activeBackend).toBe(
          PI_DEFAULT_ENGINE_ID
        );
        expect(ports.writes[0]?.chatRecords).toEqual(before);
      });

      it("preserves enabled BYOK models when moving old selections to Pi https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const initial = legacySettings();
        initial.backends = {
          opencode: { enabledModels: ["byok-openai:gpt-4o", "agent-claude:sonnet"] },
        };
        const { ports, migration } = harness(initial);
        await migration.migrate();
        expect(ports.settings.backends).toMatchObject({
          pi: { enabledModels: ["byok-openai:gpt-4o"] },
        });
      });

      it("is idempotent and never duplicates data on a repeated run", async () => {
        const { ports, migration } = harness();
        await migration.migrate();
        const afterFirst = ports.writes[0];

        const second = await migration.migrate();

        expect(second).toMatchObject({ status: "already_current", changes: [] });
        expect(ports.writes).toHaveLength(1);
        expect(ports.backups).toHaveLength(1);
        const providers = afterFirst?.providers as Record<string, unknown>;
        expect(Object.keys(providers)).toHaveLength(2);
      });

      it("leaves the configuration untouched when the backup fails and succeeds on retry", async () => {
        const { ports, migration } = harness();
        const original = ports.settings;
        ports.failBackup = true;

        const failed = await migration.migrate();

        expect(failed.status).toBe("failed");
        expect(failed.error).toContain("no space for backup");
        expect(ports.writes).toEqual([]);
        expect(ports.settings).toBe(original);

        ports.failBackup = false;
        const retried = await migration.migrate();

        expect(retried.status).toBe("migrated");
        expect(ports.writes).toHaveLength(1);
        expect(
          (ports.writes[0]?.providers as Record<string, unknown>)["byok-openai"]
        ).toBeDefined();
      });

      it("leaves the configuration untouched when the write fails and succeeds on retry", async () => {
        const { ports, migration } = harness();
        const original = ports.settings;
        ports.failWrite = true;

        const failed = await migration.migrate();

        expect(failed).toMatchObject({ status: "failed", backupPath: "migration/backup-0.json" });
        expect(failed.error).toContain("disk full");
        expect(ports.settings).toBe(original);
        expect(ports.settings.settingsSchemaVersion).toBeUndefined();

        ports.failWrite = false;
        const retried = await migration.migrate();

        expect(retried.status).toBe("migrated");
        expect(ports.writes).toHaveLength(1);
        expect(ports.settings.settingsSchemaVersion).toBe(PI_SETTINGS_SCHEMA_VERSION);
        expect((ports.settings.providers as Record<string, unknown>)["agent-claude"]).toBeDefined();
      });

      it("reads an unknown future schema without rewriting it", async () => {
        const { ports, migration } = harness({ settingsSchemaVersion: 99, providers: {} });

        const result = await migration.migrate();

        expect(result).toMatchObject({ status: "future_version", fromVersion: 99 });
        expect(ports.writes).toEqual([]);
        expect(ports.backups).toEqual([]);
      });
    });
  });

  describe("redactSecrets()", () => {
    it("strips secret values at any depth but keeps keychain references", () => {
      const redacted = redactSecrets({
        openAIApiKey: "sk-secret",
        nested: { refreshToken: "token-value", apiKeyKeychainId: "keychain-1" },
        list: [{ password: "pw", name: "keep" }],
      });

      expect(JSON.stringify(redacted)).not.toContain("sk-secret");
      expect(JSON.stringify(redacted)).not.toContain("token-value");
      expect(JSON.stringify(redacted)).not.toContain("pw");
      expect(redacted).toEqual({
        nested: { apiKeyKeychainId: "keychain-1" },
        list: [{ name: "keep" }],
      });
    });
  });
});
