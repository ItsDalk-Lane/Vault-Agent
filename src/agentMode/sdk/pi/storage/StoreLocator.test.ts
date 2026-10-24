import { createHash } from "node:crypto";
import * as path from "node:path";

import {
  StoreLocator,
  StoreLocatorError,
  assertHostRootId,
  computeVaultKey,
  normalizeVaultRoot,
  resolveDataRoot,
} from "./StoreLocator";

// Host-owned private storage must be fixed per platform, outside the Vault, keyed by the
// real Vault root plus the existing Keychain vault id, and never merged by display name:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");

const darwinOptions = {
  platform: "darwin" as const,
  homeDir: "/Users/me",
  env: {},
  vaultRoot: "/Users/me/Obsidian/MyVault",
  vaultId: "a1b2c3d4",
  sha256,
};

type LocatorOverrides = Partial<Omit<typeof darwinOptions, "vaultRoot">> & {
  vaultRoot?: string | null;
};

function createLocator(overrides: LocatorOverrides = {}): StoreLocator {
  return new StoreLocator({ ...darwinOptions, ...overrides });
}

describe("StoreLocator", () => {
  describe("resolveDataRoot()", () => {
    it.each([
      ["darwin", "/Users/me", "/Users/me/.vault-agent/v2"],
      ["linux", "/home/me", "/home/me/.vault-agent/v2"],
      ["win32", "C:\\Users\\me", "C:\\Users\\me\\.vault-agent\\v2"],
    ])(
      "uses one versioned home directory on %s https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      (platform, homeDir, expected) => {
        expect(
          resolveDataRoot({
            platform: platform as NodeJS.Platform,
            homeDir,
            env: { XDG_STATE_HOME: "/ignored", LOCALAPPDATA: "ignored" },
          })
        ).toBe(expected);
      }
    );

    it("keeps the private root outside the Vault and refuses a Vault that contains it", () => {
      const locator = createLocator();
      expect(locator.isProtectedPath(path.join(locator.dataRoot, "v1", "x"))).toBe(true);
      expect(locator.isProtectedPath(darwinOptions.vaultRoot)).toBe(false);

      expect(
        () =>
          new StoreLocator({
            platform: "darwin",
            homeDir: "/Users/me",
            env: {},
            vaultRoot: "/Users/me",
            vaultId: "a1b2c3d4",
            sha256,
          })
      ).toThrow(StoreLocatorError);
    });
  });

  describe("normalizeVaultRoot()", () => {
    it("collapses separators and removes trailing separators", () => {
      expect(normalizeVaultRoot("/Users/me/Obsidian/MyVault///", "darwin")).toBe(
        "/Users/me/Obsidian/MyVault"
      );
      expect(normalizeVaultRoot("C:\\Users\\Me\\Vault\\", "win32")).toBe("c:\\users\\me\\vault");
      expect(normalizeVaultRoot("c:/users/me/vault", "win32")).toBe("c:\\users\\me\\vault");
    });

    it("rejects empty or relative Vault roots", () => {
      expect(() => normalizeVaultRoot("", "darwin")).toThrow(StoreLocatorError);
      expect(() => normalizeVaultRoot("relative/vault", "darwin")).toThrow(StoreLocatorError);
    });
  });

  describe("computeVaultKey()", () => {
    it("is a stable SHA-256 of the normalized root plus vault id", () => {
      const key = computeVaultKey(
        normalizeVaultRoot(darwinOptions.vaultRoot, "darwin"),
        darwinOptions.vaultId,
        sha256
      );
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(
        computeVaultKey(
          normalizeVaultRoot("/Users/me/Obsidian/MyVault/", "darwin"),
          darwinOptions.vaultId,
          sha256
        )
      ).toBe(key);
    });

    it("does not share a store between same-named Vaults with different vault ids", () => {
      const root = "/Users/me/Obsidian/MyVault";
      const first = computeVaultKey(root, "aaaaaaaa", sha256);
      const second = computeVaultKey(root, "bbbbbbbb", sha256);
      expect(first).not.toBe(second);
    });

    it("changes when the same Vault moves, so re-association is explicit", () => {
      const before = computeVaultKey("/Users/me/Obsidian/MyVault", "a1b2c3d4", sha256);
      const moved = computeVaultKey("/Volumes/External/MyVault", "a1b2c3d4", sha256);
      expect(before).not.toBe(moved);
      expect(createLocator().relationTo(before)).toEqual({ kind: "same", vaultKey: before });
      expect(
        createLocator({
          vaultRoot: "/Volumes/External/MyVault",
        }).relationTo(before)
      ).toEqual({
        kind: "requires_reassociation",
        previousVaultKey: before,
        vaultKey: moved,
      });
    });
  });

  describe("assertHostRootId()", () => {
    it("accepts host-minted root ids", () => {
      expect(assertHostRootId("root-0190f3e2-1111-2222-3333-444455556666")).toBe(
        "root-0190f3e2-1111-2222-3333-444455556666"
      );
      expect(assertHostRootId("root-abc_123")).toBe("root-abc_123");
    });

    it("rejects traversal, separators and ids the host did not mint", () => {
      for (const rootId of [
        "",
        "..",
        "../escape",
        "root-../escape",
        "root-abc/def",
        "root-abc\\def",
        "/root-abc",
        "root-abc%2fdef",
        "root-.",
        "session-abc",
        "root-" + "a".repeat(200),
      ]) {
        expect({ rootId, throws: throws(() => assertHostRootId(rootId)) }).toEqual({
          rootId,
          throws: true,
        });
      }
    });
  });

  describe("sessionStorePaths()", () => {
    it("keeps the transcript and sidecars together and the writer lease outside the session https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const locator = createLocator();
      const rootId = "root-0190f3e2-1111-2222-3333-444455556666";
      const paths = locator.sessionStorePaths(rootId);
      const vaultRoot = path.posix.join(locator.dataRoot, "vaults", locator.vaultKey ?? "");
      const sessionRoot = path.posix.join(vaultRoot, "sessions", rootId);

      expect(paths).toEqual({
        storeDir: sessionRoot,
        metaPath: path.posix.join(sessionRoot, "meta.json"),
        leaseDir: path.posix.join(vaultRoot, "locks", rootId),
        attachmentsDir: path.posix.join(sessionRoot, "attachments"),
      });
      expect(locator.vaultStoreRoot).toBe(vaultRoot);
      expect(paths.storeDir.startsWith(locator.dataRoot)).toBe(true);
    });

    it("rejects a malicious root id before touching the path", () => {
      const locator = createLocator();
      expect(() => locator.sessionStorePaths("../escape")).toThrow(StoreLocatorError);
    });
  });

  describe("relationTo()", () => {
    it("reports the same store for the same Vault and requires re-association otherwise", () => {
      const locator = createLocator();
      const vaultKey = locator.vaultKey;
      expect(vaultKey).not.toBeNull();
      expect(locator.relationTo(vaultKey)).toEqual({ kind: "same", vaultKey });
      expect(locator.relationTo("f".repeat(64))).toEqual({
        kind: "requires_reassociation",
        previousVaultKey: "f".repeat(64),
        vaultKey,
      });
      expect(locator.relationTo(null)).toEqual({ kind: "new", vaultKey });
    });
  });

  describe("no-Vault hosts", () => {
    it("fails closed instead of inventing a shared store", () => {
      const locator = createLocator({ vaultRoot: null });
      expect(locator.vaultKey).toBeNull();
      expect(() => locator.vaultStoreRoot).toThrow(StoreLocatorError);
      expect(() => locator.sessionStorePaths("root-abc")).toThrow(StoreLocatorError);
      expect(() => locator.relationTo("f".repeat(64))).toThrow(StoreLocatorError);
    });
  });
});

function throws(callback: () => void): boolean {
  try {
    callback();
    return false;
  } catch {
    return true;
  }
}
