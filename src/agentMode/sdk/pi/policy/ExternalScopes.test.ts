import * as path from "node:path";

import {
  ExternalScopeError,
  ExternalScopes,
  type ExternalScopeFileSystem,
} from "@/agentMode/sdk/pi/policy/ExternalScopes";

// External roots can only be created by a real user click, never by the model. The root must be
// canonical and must not overlap the vault/config/state/credential protection set; duplicate roots
// merge into one scope without expanding permissions; a revoked or version-bumped scope
// immediately invalidates earlier approvals; nothing is authorized by default (not even home):
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeFileSystem implements ExternalScopeFileSystem {
  readonly realPaths = new Map<string, string>();

  async realpath(target: string): Promise<string> {
    return this.realPaths.get(target) ?? target;
  }
}

function harness(now = 1_000): {
  readonly scopes: ExternalScopes;
  readonly fileSystem: FakeFileSystem;
} {
  const fileSystem = new FakeFileSystem();
  const scopes = new ExternalScopes({
    fileSystem,
    path,
    protectedRoots: ["/vault", "/home/user/.config", "/home/user/.vault-agent"],
    now: () => now,
  });
  return { scopes, fileSystem };
}

function errorCode(run: () => Promise<unknown>): Promise<string | undefined> {
  return run().then(
    () => undefined,
    (error: unknown) => (error instanceof ExternalScopeError ? error.code : `unexpected`)
  );
}

describe("ExternalScopes", () => {
  describe("createScope()", () => {
    it("blocks a protected root's real filesystem case alias even when POSIX relative is case-sensitive https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fileSystem = {
        realpath: async (target: string) => target,
        stat: async (target: string) => ({
          dev: 1,
          ino: target.toLowerCase() === "/vault" ? 2 : 1,
        }),
      };
      const scopes = new ExternalScopes({
        fileSystem,
        path: path.posix,
        protectedRoots: ["/Vault"],
      });
      await expect(
        scopes.createScope({ root: "/vault", permissions: ["read"], createdBy: "user" })
      ).rejects.toMatchObject({ code: "ROOT_OVERLAPS_PROTECTED" });
    });

    it("keeps distinct Windows directories separate when the filesystem reports different identities https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fileSystem = {
        realpath: async (target: string) => target,
        stat: async (target: string) => ({
          dev: 1,
          ino: target === "C:\\Vault" ? 2 : target === "C:\\vault" ? 3 : 1,
        }),
      };
      const scopes = new ExternalScopes({
        fileSystem,
        path: path.win32,
        protectedRoots: ["C:\\Vault"],
      });
      await expect(
        scopes.createScope({ root: "C:\\vault", permissions: ["read"], createdBy: "user" })
      ).resolves.toMatchObject({ canonicalRoot: "C:\\vault" });
    });
    it("rejects a model-created scope", async () => {
      const { scopes } = harness();

      expect(
        await errorCode(() =>
          scopes.createScope({ root: "/home/user/docs", permissions: ["read"], createdBy: "model" })
        )
      ).toBe("MODEL_CANNOT_CREATE_SCOPE");
      expect(scopes.listScopes()).toEqual([]);
    });

    it("does not authorize home or any root by default", async () => {
      const { scopes } = harness();

      expect(scopes.listScopes()).toEqual([]);
      const home = await scopes.checkRootAccess("/home/user", "read");
      expect(home.allowed).toBe(false);
      expect(home).toMatchObject({ allowed: false, code: "ROOT_OVERLAPS_PROTECTED" });
      expect(await scopes.checkRootAccess("/home/user/docs", "read")).toMatchObject({
        allowed: false,
        code: "EXTERNAL_SCOPE_REQUIRED",
      });
    });

    it("rejects roots overlapping the vault, config or state protections", async () => {
      const { scopes, fileSystem } = harness();
      fileSystem.realPaths.set("/home/user/vault-link", "/vault/notes");

      expect(
        await errorCode(() =>
          scopes.createScope({ root: "/vault/notes", permissions: ["read"], createdBy: "user" })
        )
      ).toBe("ROOT_OVERLAPS_PROTECTED");
      expect(
        await errorCode(() =>
          scopes.createScope({ root: "/home/user/docs", permissions: ["read"], createdBy: "user" })
        )
      ).toBeUndefined();
      expect(
        await errorCode(() =>
          scopes.createScope({
            root: "/home/user/vault-link",
            permissions: ["read"],
            createdBy: "user",
          })
        )
      ).toBe("ROOT_OVERLAPS_PROTECTED");
      expect(
        await errorCode(() =>
          scopes.createScope({ root: "/vault2", permissions: ["read"], createdBy: "user" })
        )
      ).toBeUndefined();
    });

    it("records the canonical root, permissions, version and expiry", async () => {
      const { scopes } = harness();

      const scope = await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read"],
        createdBy: "user",
        expiresAtMs: 10_000,
      });

      expect(scope).toMatchObject({
        root: "/home/user/docs",
        canonicalRoot: "/home/user/docs",
        permissions: ["read"],
        version: 1,
        status: "active",
        createdBy: "user",
        expiresAtMs: 10_000,
      });
    });
  });

  describe("merge", () => {
    it("merges duplicate roots into one scope without expanding permissions", async () => {
      const { scopes } = harness();

      const first = await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read"],
        createdBy: "user",
      });
      const second = await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read"],
        createdBy: "user",
      });
      const third = await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["write"],
        createdBy: "user",
      });

      expect(first.id).toBe(second.id);
      expect(scopes.listScopes()).toHaveLength(1);
      expect(second.version).toBe(2);
      expect(second.permissions).toEqual(["read"]);
      expect(third.version).toBe(3);
      expect(third.permissions).toEqual(["read", "write"]);
    });
  });

  describe("checkAccess()", () => {
    it("allows an approved permission and rejects an unapproved one", async () => {
      const { scopes } = harness();
      const scope = await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read"],
        createdBy: "user",
      });

      expect(await scopes.checkAccess(scope.id, "read", { approvedVersion: 1 })).toMatchObject({
        allowed: true,
        version: 1,
      });
      expect(await scopes.checkAccess(scope.id, "write")).toMatchObject({
        allowed: false,
        code: "SCOPE_PERMISSION_DENIED",
      });
    });

    it("rejects the old approval immediately after revocation", async () => {
      const { scopes } = harness();
      const scope = await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read"],
        createdBy: "user",
      });
      expect(await scopes.checkAccess(scope.id, "read", { approvedVersion: 1 })).toMatchObject({
        allowed: true,
      });

      expect(await scopes.revokeScope(scope.id)).toBe(true);

      expect(await scopes.checkAccess(scope.id, "read")).toMatchObject({
        allowed: false,
        code: "EXTERNAL_SCOPE_REVOKED",
      });
      expect(await scopes.checkAccess(scope.id, "read", { approvedVersion: 1 })).toMatchObject({
        allowed: false,
        code: "EXTERNAL_SCOPE_REVOKED",
      });
    });

    it("invalidates a stale scope version after a merge", async () => {
      const { scopes } = harness();
      const first = await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read"],
        createdBy: "user",
      });
      await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read"],
        createdBy: "user",
      });

      expect(await scopes.checkAccess(first.id, "read", { approvedVersion: 1 })).toMatchObject({
        allowed: false,
        code: "EXTERNAL_SCOPE_REVOKED",
      });
    });

    it("rejects an expired scope", async () => {
      const { scopes } = harness(5_000);
      const scope = await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read"],
        createdBy: "user",
        expiresAtMs: 1_000,
      });

      expect(await scopes.checkAccess(scope.id, "read")).toMatchObject({
        allowed: false,
        code: "EXTERNAL_SCOPE_EXPIRED",
      });
    });
  });

  describe("checkRootAccess()", () => {
    it("resolves a call root against the active scopes and rejects siblings", async () => {
      const { scopes } = harness();
      await scopes.createScope({
        root: "/home/user/docs",
        permissions: ["read", "write"],
        createdBy: "user",
      });

      expect(await scopes.checkRootAccess("/home/user/docs/notes/a.md", "read")).toMatchObject({
        allowed: true,
      });
      expect(await scopes.checkRootAccess("/home/user/docs2/a.md", "read")).toMatchObject({
        allowed: false,
        code: "EXTERNAL_SCOPE_REQUIRED",
      });
      expect(await scopes.checkRootAccess("/home/user/docs/a.md", "write")).toMatchObject({
        allowed: true,
      });
    });
  });
});
