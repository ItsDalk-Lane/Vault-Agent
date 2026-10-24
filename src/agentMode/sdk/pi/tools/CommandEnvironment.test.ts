import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";

// Commands get inheritEnv:false and only host-minimal keys; secret-like parent keys and explicit
// per-command secret keys never reach the child, secretRef-style values are not expanded, and known
// secret values are redacted before output is stored:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function environment(
  platform: "darwin" | "linux" | "win32" = "linux",
  parentEnv: Record<string, string | undefined> = {}
): CommandEnvironment {
  return new CommandEnvironment({
    platform,
    parentEnv: {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/user",
      API_KEY: "sk-parent-secret-value",
      GITHUB_TOKEN: "ghp-parent-token-value",
      ...parentEnv,
    },
    knownSecrets: ["custom-secret-1234"],
  });
}

describe("CommandEnvironment", () => {
  describe("build()", () => {
    it("keeps only host-minimal keys and never API keys or tokens", () => {
      const built = environment().build();

      expect(built.inheritEnv).toBe(false);
      expect(built.env).toMatchObject({ PATH: "/usr/local/bin:/usr/bin", HOME: "/home/user" });
      expect(built.env).not.toHaveProperty("API_KEY");
      expect(built.env).not.toHaveProperty("GITHUB_TOKEN");
      expect(built.filteredParentKeys).toEqual(expect.arrayContaining(["API_KEY", "GITHUB_TOKEN"]));
    });

    it("drops secret-like or secretRef-style user values and keeps explicit non-secret ones", () => {
      const built = environment().build({
        userEnv: {
          SAFE_VALUE: "yes",
          COMMAND_TOKEN: "should-not-pass",
          REFERENCE: "secretRef:provider-key",
        },
      });

      expect(built.env).toMatchObject({ SAFE_VALUE: "yes" });
      expect(built.env).not.toHaveProperty("COMMAND_TOKEN");
      expect(built.env).not.toHaveProperty("REFERENCE");
      expect(built.filteredUserKeys).toEqual(
        expect.arrayContaining(["COMMAND_TOKEN", "REFERENCE"])
      );
    });

    it("keeps the Windows system keys without requiring a POSIX home", () => {
      const built = environment("win32", {
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATHEXT: ".EXE;.CMD",
        USERPROFILE: "C:\\Users\\example",
      }).build();

      expect(built.env).toMatchObject({
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATHEXT: ".EXE;.CMD",
        USERPROFILE: "C:\\Users\\example",
      });
    });
  });

  describe("redact()", () => {
    it("redacts known secret values and secretRef forms", () => {
      const redacted = environment().redact(
        "key=sk-parent-secret-value token=ghp-parent-token-value ref=secretRef:provider"
      );

      expect(redacted).not.toContain("sk-parent-secret-value");
      expect(redacted).not.toContain("ghp-parent-token-value");
      expect(redacted).not.toContain("secretRef:provider");
      expect(redacted).toContain("[REDACTED]");
    });
  });
});
