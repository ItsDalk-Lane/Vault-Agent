import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  PlatformPathPolicy,
  PlatformPathError,
} from "@/agentMode/sdk/pi/policy/PlatformPathPolicy";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";

// Platform aliases must not turn one target into another: Windows device namespaces, ADS streams,
// unauthorized UNC roots and trailing dot/space aliases are rejected, case sensitivity follows the
// real volume, junction/reparse aliases are judged by their real target, and a hardlinked write
// target is refused:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function winPolicy(overrides: { authorizedUncRoots?: readonly string[] } = {}): PlatformPathPolicy {
  return new PlatformPathPolicy({ platform: "win32", ...overrides });
}

function posixPolicy(caseSensitivity: "sensitive" | "insensitive"): PlatformPathPolicy {
  return new PlatformPathPolicy({ platform: "posix", caseSensitivity });
}

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof PlatformPathError ? error.code : `unexpected:${String(error)}`;
  }
}

const tempDirectories: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-platform-path-"));
  tempDirectories.push(root);
  return root;
}

afterAll(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("PlatformPathPolicy", () => {
  describe("isWithin()", () => {
    it("recognizes the POSIX filesystem root as an ancestor without needing a filesystem probe https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const policy = posixPolicy("sensitive");
      expect(policy.isWithin("/", "/vault/note.md")).toBe(true);
      expect(policy.isWithin("", "/vault/note.md")).toBe(false);
    });
  });
  describe("validate()", () => {
    it("keeps a Windows drive path and does not let a drive-letter alias bypass the root", () => {
      const policy = winPolicy();

      expect(policy.validate("C:\\vault\\note.md")).toBe("C:\\vault\\note.md");
      expect(policy.isWithin("C:\\vault", "c:\\vault2\\note.md")).toBe(false);
      expect(policy.isWithin("C:\\vault", "c:\\vault\\note.md")).toBe(true);
      expect(policy.isWithin("c:\\VAULT", "C:\\Vault\\Sub\\note.md")).toBe(true);
    });

    it("rejects Windows device namespaces, ADS streams, drive-relative paths and trailing aliases", () => {
      const policy = winPolicy();

      expect(errorCode(() => policy.validate("\\\\?\\C:\\vault\\note.md"))).toBe(
        "INVALID_ARGUMENT"
      );
      expect(errorCode(() => policy.validate("\\\\.\\C:\\vault\\note.md"))).toBe(
        "INVALID_ARGUMENT"
      );
      expect(errorCode(() => policy.validate("C:\\vault\\note.md:secret"))).toBe(
        "INVALID_ARGUMENT"
      );
      expect(errorCode(() => policy.validate("C:note.md"))).toBe("INVALID_ARGUMENT");
      expect(errorCode(() => policy.validate("C:\\vault\\note.md."))).toBe("INVALID_ARGUMENT");
      expect(errorCode(() => policy.validate("C:\\vault\\note.md "))).toBe("INVALID_ARGUMENT");
      expect(errorCode(() => policy.validate("C:\\vault\\CON"))).toBe("INVALID_ARGUMENT");
      expect(errorCode(() => policy.validate("C:\\vault\\nul.txt"))).toBe("INVALID_ARGUMENT");
    });

    it("requires explicit authorization for a UNC root", () => {
      expect(errorCode(() => winPolicy().validate("\\\\server\\share\\note.md"))).toBe(
        "INVALID_ARGUMENT"
      );

      const authorized = winPolicy({ authorizedUncRoots: ["\\\\server\\share"] });
      expect(authorized.validate("\\\\server\\share\\note.md")).toBe("\\\\server\\share\\note.md");
      expect(authorized.isWithin("\\\\server\\share", "\\\\server\\share\\note.md")).toBe(true);
      expect(authorized.isWithin("\\\\server\\share", "\\\\server\\other\\note.md")).toBe(false);
    });

    it("rejects POSIX backslash aliases and NUL", () => {
      const policy = posixPolicy("sensitive");

      expect(errorCode(() => policy.validate("/vault/a\\b.md"))).toBe("INVALID_ARGUMENT");
      expect(errorCode(() => policy.validate("/vault/\0/a.md"))).toBe("INVALID_ARGUMENT");
      expect(policy.validate("/vault/Note.md")).toBe("/vault/Note.md");
    });
  });

  describe("isSamePath()", () => {
    it("does not merge differently-cased files on a case-sensitive volume", () => {
      const linux = posixPolicy("sensitive");

      expect(linux.isSamePath("/vault/Note.md", "/vault/note.md")).toBe(false);
      expect(linux.isSamePath("/vault/Note.md", "/vault/Note.md")).toBe(true);
    });

    it("follows an insensitive volume when the real filesystem is insensitive", () => {
      const insensitive = posixPolicy("insensitive");

      expect(insensitive.isSamePath("/vault/Note.md", "/vault/note.md")).toBe(true);
    });
  });

  describe("assertWritableTarget()", () => {
    it("rejects a write target with more than one hard link", () => {
      const policy = posixPolicy("sensitive");

      expect(() => policy.assertWritableTarget({ nlink: 1 })).not.toThrow();
      expect(() => policy.assertWritableTarget({ nlink: 2 })).toThrow(PlatformPathError);
      expect(errorCode(() => policy.assertWritableTarget({ nlink: 2 }))).toBe("UNSAFE_FILE_ALIAS");
    });
  });
});

describe("PathResolver platform integration", () => {
  it("rejects a junction/reparse alias whose real target is back inside the Vault", async () => {
    const root = await tempRoot();
    const vault = path.join(root, "vault");
    const external = path.join(root, "external");
    await fs.mkdir(vault, { recursive: true });
    await fs.mkdir(external, { recursive: true });
    await fs.writeFile(path.join(vault, "note.md"), "vault note");
    // A Windows junction is a reparse point resolved like a symlink; the real target decides:
    // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    await fs.symlink(vault, path.join(external, "junction"));
    const resolver = new PathResolver({
      vaultRoot: vault,
      fileSystem: fs,
      path,
      platformPolicy: posixPolicy("sensitive"),
    });

    await expect(resolver.resolveExternalPath("junction/note.md", external)).rejects.toMatchObject({
      code: "PATH_OUT_OF_SCOPE",
    });
  });

  it("refuses to write through a hardlinked file", async () => {
    const root = await tempRoot();
    const vault = path.join(root, "vault");
    await fs.mkdir(vault, { recursive: true });
    await fs.writeFile(path.join(vault, "original.md"), "content");
    await fs.link(path.join(vault, "original.md"), path.join(vault, "alias.md"));
    const resolver = new PathResolver({
      vaultRoot: vault,
      fileSystem: fs,
      path,
      platformPolicy: posixPolicy("sensitive"),
    });

    const hardlinked = await resolver.resolveVaultPath("alias.md");
    await expect(resolver.assertWritableTarget(hardlinked)).rejects.toMatchObject({
      code: "UNSAFE_FILE_ALIAS",
    });

    const normal = await resolver.resolveVaultPath("original.md");
    await expect(resolver.assertWritableTarget(normal)).rejects.toMatchObject({
      code: "UNSAFE_FILE_ALIAS",
    });
  });
});

describe("PathResolver hardlink probe", () => {
  it("passes a single-link write target", async () => {
    const root = await tempRoot();
    const vault = path.join(root, "vault");
    await fs.mkdir(vault, { recursive: true });
    await fs.writeFile(path.join(vault, "note.md"), "content");
    const resolver = new PathResolver({
      vaultRoot: vault,
      fileSystem: fs,
      path,
      platformPolicy: posixPolicy("sensitive"),
    });

    const target = await resolver.resolveVaultPath("note.md");

    await expect(resolver.assertWritableTarget(target)).resolves.toBeUndefined();
  });
});
