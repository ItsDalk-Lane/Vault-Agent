import type { App } from "obsidian";

import { DEFAULT_SETTINGS } from "@/constants";
import type { Provider } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { loadSettingsWithKeychain, resetPersistenceState } from "@/services/settingsPersistence";
import type { VaultAgentSettings } from "@/settings/model";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;
}

const VAULT_ID = "1234abcd";
const STABLE_NAME = `copilot-v${VAULT_ID}-provider-anthropic-api-key`;

let secrets: Map<string, string>;

function makeApp(): App {
  return {
    secretStorage: {
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
      listSecrets: () => Array.from(secrets.keys()),
      deleteSecret: (id: string) => {
        secrets.delete(id);
      },
    },
    vault: { adapter: {} },
  } as unknown as App;
}

function anthropicRow(apiKeyKeychainId: string): Provider {
  return {
    providerId: "row-anthropic",
    providerType: "anthropic",
    displayName: "Anthropic",
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
    requiresApiKey: true,
    apiKeyKeychainId,
  };
}

function diskSettings(pointer: string): VaultAgentSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    _keychainVaultId: VAULT_ID,
    providers: { "row-anthropic": anthropicRow(pointer) },
  };
}

async function load(
  raw: unknown
): Promise<{ settings: VaultAgentSettings; saved: VaultAgentSettings | undefined }> {
  let saved: VaultAgentSettings | undefined;
  const settings = await loadSettingsWithKeychain(raw, async (data) => {
    saved = structuredClone(data);
  });
  return { settings, saved };
}

function apiKeyFor(app: App, settings: VaultAgentSettings): string | null {
  const pointer = settings.providers["row-anthropic"].apiKeyKeychainId!;
  return KeychainService.getInstance(app).getSecretById(pointer);
}

describe("settingsPersistence", () => {
  describe("loadSettingsWithKeychain()", () => {
    beforeEach(() => {
      secrets = new Map();
      resetPersistenceState();
      KeychainService.resetInstance();
    });

    it("loads the configured Keychain pointer without moving or deleting unrelated keys https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const app = makeApp();
      KeychainService.getInstance(app);
      secrets.set(STABLE_NAME, "sk-ant-12345");
      secrets.set(`copilot-v${VAULT_ID}-provider-row-anthropic`, "untouched");

      const { settings: loaded, saved } = await load(diskSettings(STABLE_NAME));

      expect(apiKeyFor(app, loaded)).toBe("sk-ant-12345");
      expect(saved).toBeUndefined();
      expect(secrets.get(`copilot-v${VAULT_ID}-provider-row-anthropic`)).toBe("untouched");
      expect(loaded.providers["row-anthropic"].apiKeyKeychainId).toBe(STABLE_NAME);
    });
  });
});
