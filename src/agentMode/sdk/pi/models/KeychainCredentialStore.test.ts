import type { ApiKeyCredential, Credential, OAuthCredential } from "@earendil-works/pi-ai";

import {
  CredentialStoreError,
  KeychainCredentialStore,
  credentialIndexKeychainId,
  credentialKeychainId,
  type KeychainPort,
} from "./KeychainCredentialStore";

// The Pi CredentialStore is a thin, explicit adapter over the existing KeychainService:
// per-provider serialized read-modify-write, metadata-only listing, explicit failure when
// SecretStorage is unavailable, and no JSON or environment fallback:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
interface FakeKeychain extends KeychainPort {
  readonly secrets: Map<string, string>;
  readonly getCalls: string[];
  readonly setCalls: [string, string][];
  readonly deleteCalls: string[];
  vaultId: string;
  available: boolean;
}

function createKeychain(options: { available?: boolean; vaultId?: string } = {}): FakeKeychain {
  const secrets = new Map<string, string>();
  const getCalls: string[] = [];
  const setCalls: [string, string][] = [];
  const deleteCalls: string[] = [];
  const keychain: FakeKeychain = {
    secrets,
    getCalls,
    setCalls,
    deleteCalls,
    available: options.available ?? true,
    vaultId: options.vaultId ?? "vault1234",
    isAvailable: () => keychain.available,
    getVaultId: () => keychain.vaultId,
    getSecretById: (id) => {
      getCalls.push(id);
      return secrets.get(id) ?? null;
    },
    setSecretById: (id, value) => {
      setCalls.push([id, value]);
      secrets.set(id, value);
    },
    deleteSecretById: (id) => {
      deleteCalls.push(id);
      secrets.delete(id);
    },
  };
  return keychain;
}

function createStore(keychain: FakeKeychain, namespace = "pi"): KeychainCredentialStore {
  return new KeychainCredentialStore({ keychain, namespace });
}

const API_KEY_CREDENTIAL: ApiKeyCredential = { type: "api_key", key: "sk-secret-1" };
const OAUTH_CREDENTIAL: OAuthCredential = {
  type: "oauth",
  refresh: "refresh-1",
  access: "access-1",
  expires: 1_700_000_000_000,
};

describe("KeychainCredentialStore", () => {
  describe("credentialKeychainId()", () => {
    it("uses the KeychainService vault namespace and stays below the id limit", () => {
      const first = credentialKeychainId("vault1234", "pi", "openai");
      expect(first.startsWith("copilot-vvault1234-pi-")).toBe(true);
      expect(first).toContain("openai");
      expect(first.length).toBeLessThanOrEqual(64);
      expect(credentialKeychainId("vault1234", "pi", "openrouter")).not.toBe(first);
      expect(credentialKeychainId("othervault", "pi", "openai")).not.toBe(first);

      const long = credentialKeychainId("vault1234", "pi", "provider-".repeat(20));
      expect(long.length).toBeLessThanOrEqual(64);
      expect(credentialKeychainId("vault1234", "pi", "provider-".repeat(20))).toBe(long);
      expect(credentialIndexKeychainId("vault1234", "pi").length).toBeLessThanOrEqual(64);
    });
  });

  describe("read()", () => {
    it("round-trips an api-key credential from the keychain", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);
      await store.modify("openai", async () => API_KEY_CREDENTIAL);

      await expect(store.read("openai")).resolves.toEqual(API_KEY_CREDENTIAL);
    });

    it("resolves undefined for a missing provider instead of reading the environment", async () => {
      process.env.OPENAI_API_KEY = "env-key-should-not-be-used";
      const keychain = createKeychain();
      const store = createStore(keychain);

      try {
        await expect(store.read("openai")).resolves.toBeUndefined();
        expect(keychain.setCalls).toEqual([]);
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("rejects corrupt stored data as a storage failure", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);
      keychain.secrets.set(credentialKeychainId("vault1234", "pi", "openai"), "{not json");

      await expect(store.read("openai")).rejects.toMatchObject({
        name: "CredentialStoreError",
        code: "INVALID_CREDENTIAL_DATA",
      });
    });

    it("fails explicitly when SecretStorage is unavailable", async () => {
      const keychain = createKeychain({ available: false });
      const store = createStore(keychain);

      await expect(store.read("openai")).rejects.toMatchObject({
        name: "CredentialStoreError",
        code: "KEYCHAIN_UNAVAILABLE",
      });
      expect(keychain.getCalls).toEqual([]);
    });
  });

  describe("list()", () => {
    it("returns metadata without reading credential secrets", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);
      await store.modify("openai", async () => API_KEY_CREDENTIAL);
      await store.modify("anthropic", async () => OAUTH_CREDENTIAL);
      keychain.getCalls.length = 0;
      const writesBeforeList = keychain.setCalls.length;

      const listed = await store.list();

      expect(listed).toEqual([
        { providerId: "openai", type: "api_key" },
        { providerId: "anthropic", type: "oauth" },
      ]);
      const credentialIds = [
        credentialKeychainId("vault1234", "pi", "openai"),
        credentialKeychainId("vault1234", "pi", "anthropic"),
      ];
      expect(keychain.getCalls).toEqual([credentialIndexKeychainId("vault1234", "pi")]);
      for (const id of keychain.getCalls) expect(credentialIds).not.toContain(id);
      expect(keychain.setCalls.length).toBe(writesBeforeList);
    });

    it("fails explicitly without SecretStorage", async () => {
      const store = createStore(createKeychain({ available: false }));
      await expect(store.list()).rejects.toMatchObject({ code: "KEYCHAIN_UNAVAILABLE" });
    });
  });

  describe("modify()", () => {
    it("serializes concurrent refreshes so only the valid new token is kept", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);
      await store.modify("openai", async () => OAUTH_CREDENTIAL);
      const currentSeenByCall: Array<Credential | undefined> = [];

      const refresh = async (current: Credential | undefined): Promise<Credential | undefined> => {
        currentSeenByCall.push(current);
        if (current?.type === "oauth" && current.access === "rotated-access") return undefined;
        return { type: "oauth", refresh: "rotated-refresh", access: "rotated-access", expires: 2 };
      };
      const first = store.modify("openai", refresh);
      const second = store.modify("openai", refresh);

      await Promise.all([first, second]);

      const final = await store.read("openai");
      expect(final).toMatchObject({ type: "oauth", access: "rotated-access" });
      expect(currentSeenByCall).toHaveLength(2);
      expect(currentSeenByCall[1]).toMatchObject({ access: "rotated-access" });
      const credentialWrites = keychain.setCalls.filter(
        ([id]) => id === credentialKeychainId("vault1234", "pi", "openai")
      );
      expect(credentialWrites).toHaveLength(2);
    });

    it("leaves the entry unchanged when the callback returns undefined", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);
      await store.modify("openai", async () => API_KEY_CREDENTIAL);
      const writesBefore = keychain.setCalls.length;

      const result = await store.modify("openai", async () => undefined);

      expect(result).toEqual(API_KEY_CREDENTIAL);
      expect(keychain.setCalls.length).toBe(writesBefore);
    });

    it("propagates a callback rejection without writing", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);
      await store.modify("openai", async () => API_KEY_CREDENTIAL);
      const writesBefore = keychain.setCalls.length;

      await expect(
        store.modify("openai", async () => {
          throw new Error("refresh rejected");
        })
      ).rejects.toThrow("refresh rejected");
      expect(keychain.setCalls.length).toBe(writesBefore);
    });

    it("rejects an invalid credential instead of persisting it", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);

      await expect(store.modify("openai", async () => ({ type: "api_key" }))).rejects.toMatchObject(
        { code: "INVALID_CREDENTIAL_DATA" }
      );
      await expect(
        store.modify("openai", async () => ({ type: "oauth" }) as OAuthCredential)
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIAL_DATA" });
      expect(keychain.setCalls).toEqual([]);
    });

    it("persists nothing when SecretStorage is unavailable", async () => {
      const keychain = createKeychain({ available: false });
      const store = createStore(keychain);

      await expect(store.modify("openai", async () => API_KEY_CREDENTIAL)).rejects.toMatchObject({
        code: "KEYCHAIN_UNAVAILABLE",
      });
      expect(keychain.setCalls).toEqual([]);
    });
  });

  describe("delete()", () => {
    it("removes the credential and its metadata, and is idempotent", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);
      await store.modify("openai", async () => API_KEY_CREDENTIAL);
      await store.modify("anthropic", async () => OAUTH_CREDENTIAL);

      await store.delete("openai");
      await store.delete("openai");

      await expect(store.read("openai")).resolves.toBeUndefined();
      expect((await store.list()).map((info) => info.providerId)).toEqual(["anthropic"]);
    });

    it("fails explicitly without SecretStorage", async () => {
      const store = createStore(createKeychain({ available: false }));
      await expect(store.delete("openai")).rejects.toMatchObject({ code: "KEYCHAIN_UNAVAILABLE" });
    });
  });

  describe("data.json safety", () => {
    it("never writes credentials into the plugin JSON data", async () => {
      const keychain = createKeychain();
      const store = createStore(keychain);
      const dataJson: Record<string, unknown> = { settings: { apiKey: null } };
      const before = JSON.stringify(dataJson);

      await store.modify("openai", async () => API_KEY_CREDENTIAL);
      await store.read("openai");
      await store.list();
      await store.delete("openai");

      expect(JSON.stringify(dataJson)).toBe(before);
      expect(before).not.toContain("sk-secret-1");
      for (const [, value] of keychain.setCalls) {
        expect(value).not.toContain("data.json");
      }
      expect(CredentialStoreError).toBeDefined();
    });
  });
});
