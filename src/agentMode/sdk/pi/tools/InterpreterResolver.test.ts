import * as path from "node:path";

import {
  InterpreterResolver,
  type HostPlatform,
  type InterpreterFileSystem,
} from "@/agentMode/sdk/pi/tools/InterpreterResolver";

// The resolver only uses absolute paths that actually exist on the host (or a user-configured
// absolute path), never PATH lookups and never a download. Windows uses its system PowerShell and
// does not require Git Bash; a missing interpreter disables only that command capability while
// chat, vault and native file tools keep working:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeFileSystem implements InterpreterFileSystem {
  readonly files = new Set<string>();
  readonly checked: string[] = [];

  async exists(target: string): Promise<boolean> {
    this.checked.push(target);
    return this.files.has(target);
  }
}

function resolver(
  platform: HostPlatform,
  files: readonly string[],
  configured?: { bash?: string; powershell?: string }
): { resolver: InterpreterResolver; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  for (const file of files) fileSystem.files.add(file);
  return {
    resolver: new InterpreterResolver({
      platform,
      fileSystem,
      path,
      ...(configured !== undefined ? { configured } : {}),
    }),
    fileSystem,
  };
}

describe("InterpreterResolver", () => {
  describe("resolve()", () => {
    it("selects the existing system bash absolute path on macOS and Linux", async () => {
      const harnessed = resolver("darwin", ["/bin/bash"]);

      const resolved = await harnessed.resolver.resolve("bash");

      expect(resolved).toMatchObject({ available: true, path: "/bin/bash", source: "system" });
      expect(harnessed.fileSystem.checked).toContain("/bin/bash");
    });

    it("uses the Windows system PowerShell without requiring Git Bash", async () => {
      const systemPowerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
      const harnessed = resolver("win32", [systemPowerShell]);

      const bash = await harnessed.resolver.resolve("bash");
      const powershell = await harnessed.resolver.resolve("powershell");

      expect(bash).toMatchObject({ available: false, code: "INTERPRETER_UNAVAILABLE" });
      expect(harnessed.resolver.candidatePaths("bash")).toEqual([]);
      expect(powershell).toMatchObject({
        available: true,
        path: systemPowerShell,
        source: "system",
      });
    });

    it("honours a user-configured absolute path and ignores a relative one", async () => {
      const harnessed = resolver("linux", ["/bin/bash", "/opt/tools/bash"], {
        bash: "/opt/tools/bash",
      });
      const relative = resolver("linux", ["/bin/bash"], { bash: "bash" });

      expect(await harnessed.resolver.resolve("bash")).toMatchObject({
        available: true,
        path: "/opt/tools/bash",
        source: "configured",
      });
      expect(await relative.resolver.resolve("bash")).toMatchObject({
        available: true,
        path: "/bin/bash",
        source: "system",
      });
    });

    it("reports a missing interpreter without falling back to PATH", async () => {
      const harnessed = resolver("darwin", []);

      const resolved = await harnessed.resolver.resolve("bash");

      expect(resolved).toMatchObject({ available: false, code: "INTERPRETER_UNAVAILABLE" });
      for (const candidate of harnessed.resolver.candidatePaths("bash")) {
        expect(path.isAbsolute(candidate)).toBe(true);
        expect(candidate).not.toBe("bash");
      }
      expect(harnessed.resolver.candidatePaths("bash")).not.toContain(process.execPath);
    });

    it("rejects an unsupported interpreter id such as node", async () => {
      const harnessed = resolver("darwin", ["/bin/bash"]);

      expect(await harnessed.resolver.resolve("node")).toMatchObject({
        available: false,
        code: "UNSUPPORTED_INTERPRETER",
      });
    });
  });

  describe("capabilityStatus()", () => {
    it("keeps chat, vault and native files available when no command interpreter exists", async () => {
      const harnessed = resolver("darwin", []);

      const status = await harnessed.resolver.capabilityStatus();

      expect(status).toMatchObject({ chat: true, vault: true, nativeFiles: true });
      expect(status.commands.bash.available).toBe(false);
      expect(status.commands.powershell.available).toBe(false);
    });
  });
});
