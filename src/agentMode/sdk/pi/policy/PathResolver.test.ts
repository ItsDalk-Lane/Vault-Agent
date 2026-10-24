import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  PathResolver,
  PathResolverError,
  isPathWithin,
  type PathResolution,
} from "@/agentMode/sdk/pi/policy/PathResolver";

// The resolver classifies every target before approval: Vault paths stay relative to the Vault
// root, external paths need an explicit root, symlinks are judged by their real target, `..`
// escapes and prefix lookalikes are rejected, and host state/config/credential roots are protected:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
interface Fixture {
  readonly root: string;
  readonly vault: string;
  readonly vaultReal: string;
  readonly vault2: string;
  readonly external: string;
  readonly externalReal: string;
  readonly other: string;
  readonly state: string;
  readonly resolver: PathResolver;
}

const tempDirectories: string[] = [];

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-path-resolver-"));
  tempDirectories.push(root);
  const vault = path.join(root, "vault");
  const vault2 = path.join(root, "vault2");
  const external = path.join(root, "external");
  const other = path.join(root, "other");
  const state = path.join(root, "state");
  for (const directory of [vault, vault2, external, other, state]) {
    await fs.mkdir(directory, { recursive: true });
  }
  await fs.writeFile(path.join(vault, "note.md"), "vault note");
  await fs.writeFile(path.join(vault2, "note.md"), "lookalike note");
  await fs.writeFile(path.join(external, "note.md"), "external note");
  await fs.writeFile(path.join(state, "store.jsonl"), "{}");
  // An external directory whose symlink points back into the Vault, and a Vault entry that points
  // outside the Vault: both are aliases whose real target decides the classification:
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  await fs.symlink(vault, path.join(external, "vault-link"));
  await fs.symlink(path.join(external, "note.md"), path.join(vault, "external-link.md"));
  const [vaultReal, externalReal] = await Promise.all([fs.realpath(vault), fs.realpath(external)]);
  const resolver = new PathResolver({
    vaultRoot: vault,
    protectedRoots: [state, path.join(vault, ".vault-agent")],
    fileSystem: fs,
    path,
  });
  return { root, vault, vaultReal, vault2, external, externalReal, other, state, resolver };
}

function errorCode(run: () => Promise<unknown>): Promise<string | undefined> {
  return run().then(
    () => undefined,
    (error: unknown) =>
      error instanceof PathResolverError ? error.code : `unexpected:${String(error)}`
  );
}

function windowsFixture(insensitive = false) {
  const entries = new Map<string, { ino: number; real?: string }>([
    ["C:\\", { ino: 1 }],
    ["C:\\Vault", { ino: 2 }],
    ["C:\\Vault\\Notes", { ino: 3 }],
    ["C:\\Vault\\Notes\\note.md", { ino: 4 }],
    ["C:\\Vault\\.Secrets", { ino: 5 }],
    ["C:\\Vault\\.Secrets\\key", { ino: 6 }],
    ["C:\\External", { ino: 7 }],
    ["C:\\External\\note.md", { ino: 8 }],
    ["C:\\vault", { ino: 9 }],
    ["C:\\vault\\note.md", { ino: 10 }],
    ["C:\\Vault\\link.md", { ino: 10, real: "C:\\vault\\note.md" }],
  ]);
  if (insensitive) {
    entries.delete("C:\\vault");
    entries.delete("C:\\vault\\note.md");
  }
  const find = (target: string) => {
    const normalized = path.win32.normalize(target);
    const entry =
      entries.get(normalized) ??
      (insensitive
        ? [...entries].find(([name]) => name.toLowerCase() === normalized.toLowerCase())?.[1]
        : undefined);
    if (!entry) throw Object.assign(new Error("fixture missing path"), { code: "ENOENT" });
    return entry;
  };
  const fileSystem = {
    realpath: async (target: string) => find(target).real ?? path.win32.normalize(target),
    stat: async (target: string) => ({ dev: 1, ino: find(target).ino }),
    lstat: async () => ({ nlink: 1 }),
  };
  return {
    entries,
    fileSystem,
    resolver: new PathResolver({
      vaultRoot: "C:\\Vault",
      protectedRoots: ["C:\\Vault\\.Secrets"],
      path: path.win32,
      fileSystem,
    }),
  };
}

afterAll(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("PathResolver", () => {
  describe("isPathWithin()", () => {
    it("requires exact path segments or an actual matching filesystem identity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { fileSystem } = windowsFixture(true);
      await expect(
        isPathWithin("C:\\Vault", "C:\\VAULT\\Notes\\note.md", path.win32, fileSystem)
      ).resolves.toBe(true);
      const sensitive = windowsFixture();
      await expect(
        isPathWithin("C:\\Vault", "C:\\vault\\note.md", path.win32, sensitive.fileSystem)
      ).resolves.toBe(false);
      await expect(isPathWithin("/vault", "/vault2/note.md", path.posix, {})).resolves.toBe(false);
      await expect(isPathWithin("/vault", "/vault/note.md", path.posix, {})).resolves.toBe(true);
    });

    it("refuses an ambiguous alias when the filesystem cannot provide a reliable identity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      await expect(isPathWithin("/Vault", "/vault/note.md", path.posix, {})).rejects.toMatchObject({
        code: "PATH_RESOLUTION_FAILED",
      });
      await expect(
        isPathWithin("/Vault", "/vault/note.md", path.posix, {
          stat: async () => ({ dev: 1, ino: 0 }),
        })
      ).rejects.toMatchObject({ code: "PATH_RESOLUTION_FAILED" });
      await expect(
        isPathWithin("/Vault", "/vault/note.md", path.posix, {
          stat: async () => ({ dev: 1, ino: Number.MAX_SAFE_INTEGER + 1 }),
        })
      ).rejects.toMatchObject({ code: "PATH_RESOLUTION_FAILED" });
    });
  });
  describe("resolveVaultPath()", () => {
    it("returns a safe Vault-relative path when an allowed link resolves through a confirmed root case alias https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const resolver = new PathResolver({
        vaultRoot: "/Vault",
        path: path.posix,
        fileSystem: {
          realpath: async (target) => (target === "/Vault/link.md" ? "/vault/note.md" : target),
          stat: async (target) => ({ dev: 1, ino: target.toLowerCase() === "/vault" ? 2 : 3 }),
        },
      });
      await expect(resolver.resolveVaultPath("link.md")).resolves.toMatchObject({
        canonical: "/vault/note.md",
        relative: "note.md",
      });
    });
    it("uses the injected Windows path operations by default for ordinary relative paths https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { resolver } = windowsFixture();
      await expect(resolver.resolveVaultPath("Notes\\note.md")).resolves.toMatchObject({
        canonical: "C:\\Vault\\Notes\\note.md",
        relative: "Notes/note.md",
      });
    });

    it.each([
      "Notes/note.md:secret",
      "Notes/NUL.txt",
      "Notes/COM1.log",
      "Notes/note.md.",
      "Notes/note.md ",
      "C:relative.md",
      "\\\\?\\C:\\Vault\\note.md",
      "\\\\server\\share\\note.md",
    ])(
      "rejects the Windows alias %s before touching the filesystem https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (target) => {
        const { resolver, fileSystem } = windowsFixture();
        const realpath = jest.spyOn(fileSystem, "realpath");
        await expect(resolver.resolveVaultPath(target)).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
        });
        expect(realpath).not.toHaveBeenCalled();
      }
    );

    it("does not let win32.relative merge a distinct case-sensitive directory into the Vault https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { resolver } = windowsFixture();
      await expect(resolver.resolveVaultPath("link.md")).rejects.toMatchObject({
        code: "PATH_OUT_OF_SCOPE",
      });
    });

    it("identifies protected roots through a volume-confirmed case alias https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { resolver } = windowsFixture(true);
      await expect(resolver.resolveVaultPath(".SECRETS/key")).rejects.toMatchObject({
        code: "PROTECTED_PATH",
      });
    });
    it("resolves a Vault-relative path inside the Vault root", async () => {
      const fixture = await createFixture();

      const resolved = await fixture.resolver.resolveVaultPath("note.md");

      expect(resolved.kind).toBe("vault");
      expect(resolved.canonical).toBe(path.join(fixture.vaultReal, "note.md"));
      expect(resolved.relative).toBe("note.md");
    });

    it("rejects an absolute path, a backslash alias, a URL scheme or NUL", async () => {
      const fixture = await createFixture();

      expect(await errorCode(() => fixture.resolver.resolveVaultPath("/etc/passwd"))).toBe(
        "INVALID_ARGUMENT"
      );
      expect(await errorCode(() => fixture.resolver.resolveVaultPath("notes\\a.md"))).toBe(
        "INVALID_ARGUMENT"
      );
      expect(await errorCode(() => fixture.resolver.resolveVaultPath("file:///etc/passwd"))).toBe(
        "INVALID_ARGUMENT"
      );
      expect(await errorCode(() => fixture.resolver.resolveVaultPath("notes/\0/a.md"))).toBe(
        "INVALID_ARGUMENT"
      );
    });

    it("rejects a `..` escape instead of normalizing it away", async () => {
      const fixture = await createFixture();

      expect(await errorCode(() => fixture.resolver.resolveVaultPath("../secret.md"))).toBe(
        "PATH_OUT_OF_SCOPE"
      );
      expect(
        await errorCode(() => fixture.resolver.resolveVaultPath("notes/../../vault2/x.md"))
      ).toBe("PATH_OUT_OF_SCOPE");
    });

    it("rejects a Vault entry whose symlink points outside the Vault", async () => {
      const fixture = await createFixture();

      expect(await errorCode(() => fixture.resolver.resolveVaultPath("external-link.md"))).toBe(
        "PATH_OUT_OF_SCOPE"
      );
    });

    it("rejects protected host state roots", async () => {
      const fixture = await createFixture();

      expect(
        await errorCode(() => fixture.resolver.resolveVaultPath(".vault-agent/store.jsonl"))
      ).toBe("PROTECTED_PATH");
    });
  });

  describe("resolveExternalPath()", () => {
    it("accepts a Windows drive-absolute target only inside its explicitly provided external root https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { resolver } = windowsFixture();
      await expect(
        resolver.resolveExternalPath("C:\\External\\note.md", "C:\\External")
      ).resolves.toMatchObject({ kind: "external", canonical: "C:\\External\\note.md" });
    });

    it("accepts a UNC target only under the explicitly authorized UNC external root https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { resolver, entries } = windowsFixture();
      entries.set("\\\\server\\share\\", { ino: 30 });
      entries.set("\\\\server\\share\\note.md", { ino: 31 });
      await expect(
        resolver.resolveExternalPath("\\\\server\\share\\note.md", "\\\\server\\share\\")
      ).resolves.toMatchObject({ canonical: "\\\\server\\share\\note.md" });
      await expect(
        resolver.resolveExternalPath("\\\\other\\share\\note.md", "\\\\server\\share\\")
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });
    it("resolves a relative path against the explicit external root", async () => {
      const fixture = await createFixture();

      const resolved = await fixture.resolver.resolveExternalPath("note.md", fixture.external);

      expect(resolved.kind).toBe("external");
      expect(resolved.canonical).toBe(path.join(fixture.externalReal, "note.md"));
    });

    it("does not treat a lookalike sibling as the Vault root", async () => {
      const fixture = await createFixture();

      await expect(
        fixture.resolver.resolveExternalPath(path.join(fixture.vault2, "note.md"), fixture.vault)
      ).rejects.toMatchObject({
        code: "PATH_OUT_OF_SCOPE",
        message: expect.stringContaining("outside the external root"),
      });
    });

    it("rejects an external alias whose real target is inside the Vault", async () => {
      const fixture = await createFixture();

      expect(
        await errorCode(() =>
          fixture.resolver.resolveExternalPath("vault-link/note.md", fixture.external)
        )
      ).toBe("PATH_OUT_OF_SCOPE");
    });

    it("rejects a new file under a parent symlink that points back into the Vault", async () => {
      const fixture = await createFixture();

      expect(
        await errorCode(() =>
          fixture.resolver.resolveExternalPath("vault-link/new-note.md", fixture.external)
        )
      ).toBe("PATH_OUT_OF_SCOPE");
    });

    it("rejects protected host state roots for external tools too", async () => {
      const fixture = await createFixture();

      expect(
        await errorCode(() =>
          fixture.resolver.resolveExternalPath(
            path.join(fixture.state, "store.jsonl"),
            fixture.root
          )
        )
      ).toBe("PROTECTED_PATH");
    });
  });

  describe("revalidate()", () => {
    it("rejects a target that became a symlink to another root after approval", async () => {
      const fixture = await createFixture();
      const resolved = await fixture.resolver.resolveVaultPath("note.md");
      await fs.rm(path.join(fixture.vault, "note.md"));
      await fs.symlink(path.join(fixture.external, "note.md"), path.join(fixture.vault, "note.md"));

      expect(await errorCode(() => fixture.resolver.revalidate(resolved))).toBe(
        "PATH_OUT_OF_SCOPE"
      );
    });

    it("returns the same canonical target when nothing changed", async () => {
      const fixture = await createFixture();
      const resolved = await fixture.resolver.resolveVaultPath("note.md");

      const revalidated: PathResolution = await fixture.resolver.revalidate(resolved);

      expect(revalidated.canonical).toBe(resolved.canonical);
    });
  });
});
