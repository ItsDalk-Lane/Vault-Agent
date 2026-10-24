import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

import { HostExecutionPolicy } from "@/agentMode/sdk/pi/policy/HostExecutionPolicy";
import {
  InterpreterResolver,
  type HostPlatform,
} from "@/agentMode/sdk/pi/tools/InterpreterResolver";
import {
  NativeCommands,
  loadOfficialNativeCommandRegistrations,
  type NativeCommandRegistrations,
} from "@/agentMode/sdk/pi/tools/NativeCommands";
import type {
  NativeToolApiLike,
  NativeToolRegistrationLike,
  NativeToolResult,
} from "@/agentMode/sdk/pi/tools/NativeTools";
import * as path from "node:path";

// Native bash/powershell are only offered through the native execution environment; strict never
// spawns, trusted_host needs a fresh concrete approval for every command, the resolver's absolute
// interpreter path is injected into the actual process invocation, overlong timeouts are clamped,
// and a missing interpreter disables only commands (chat/vault/native files keep working):
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeNodeEnv {
  readonly execCalls: Array<{ command: string | readonly string[]; options: unknown }> = [];
  readonly id = "fake-env";
  cwd = "/home/user/projects";

  async exec(
    command: string | readonly string[],
    options?: unknown
  ): Promise<{ ok: true; value: { exitCode: number } }> {
    this.execCalls.push({ command, options });
    return { ok: true, value: { exitCode: 0 } };
  }
}

class FakeResolverFileSystem {
  readonly files = new Set<string>();
  async exists(target: string): Promise<boolean> {
    return this.files.has(target);
  }
}

function shellRegistration(counter: { calls: number }, fail = false): NativeToolRegistrationLike {
  return {
    name: "shell",
    parameters: {},
    execute: async (
      args: Record<string, unknown>,
      api: NativeToolApiLike
    ): Promise<NativeToolResult> => {
      counter.calls += 1;
      if (fail) return { output: [{ type: "text", text: "command failed" }], isError: true };
      const env = api.env as ExecutionEnv;
      const timeout = typeof args.timeout === "number" ? args.timeout : undefined;
      const result = await env.exec(String(args.command), { timeout }, {} as never);
      if (!result.ok) return { output: [{ type: "text", text: "exec failed" }], isError: true };
      return { output: [{ type: "text", text: "ran" }] };
    },
  };
}

interface Harness {
  readonly commands: NativeCommands;
  readonly env: FakeNodeEnv;
  readonly policy: HostExecutionPolicy;
  readonly resolver: InterpreterResolver;
  readonly bashCalls: { calls: number };
  readonly powershellCalls: { calls: number };
}

function harness(
  options: {
    platform?: HostPlatform;
    files?: readonly string[];
    configured?: { bash?: string };
    trusted?: boolean;
    nativeFail?: boolean;
  } = {}
): Harness {
  const platform = options.platform ?? "darwin";
  const env = new FakeNodeEnv();
  const resolverFs = new FakeResolverFileSystem();
  for (const file of options.files ?? ["/bin/bash"]) resolverFs.files.add(file);
  const resolver = new InterpreterResolver({
    platform,
    fileSystem: resolverFs,
    path,
    ...(options.configured !== undefined ? { configured: options.configured } : {}),
  });
  const policy = new HostExecutionPolicy({
    path,
    vaultRoot: "/vault",
    interpreter: { available: true, label: "/bin/bash" },
    defaultCwd: "/home/user/projects",
    now: () => 1_000,
  });
  if (options.trusted === true) {
    policy.confirmTrustedHost({ confirmedBy: "user", riskAcknowledged: true, noticeVersion: 1 });
  }
  const bashCalls = { calls: 0 };
  const powershellCalls = { calls: 0 };
  const registrations: NativeCommandRegistrations = {
    bash: shellRegistration(bashCalls, options.nativeFail === true),
    powershell: shellRegistration(powershellCalls),
  };
  const commands = new NativeCommands({
    registrations,
    policy,
    interpreter: resolver,
    env: env as unknown as ExecutionEnv,
    path,
    defaultCwd: "/home/user/projects",
    now: () => 1_000,
  });
  return { commands, env, policy, resolver, bashCalls, powershellCalls };
}

function outputText(result: NativeToolResult): string {
  const output = result.output;
  if (output === undefined) return "";
  if (typeof output === "string") return output;
  return output.map((item) => item.text).join("");
}

function approve(
  harnessed: Harness,
  command = "echo hi",
  interpreter = "/bin/bash",
  timeoutMs = 60_000
) {
  const approved = harnessed.policy.approveCommand(
    {
      command,
      cwd: "/home/user/projects",
      interpreter,
      timeoutMs,
      outputLimitBytes: 64 * 1024,
    },
    { approvedByUser: true }
  );
  if (!approved.ok) throw new Error(approved.code);
  return approved.token;
}

describe("NativeCommands", () => {
  describe("execute()", () => {
    it("disables only bash when no interpreter exists while chat and vault stay available", async () => {
      const harnessed = harness({ files: [] });

      const status = await harnessed.commands.capabilityStatus();
      const result = await harnessed.commands.execute("bash", { command: "echo hi" }, {}, {});

      expect(status).toMatchObject({ chat: true, vault: true, nativeFiles: true });
      expect(status.commands.bash.available).toBe(false);
      expect(result.isError).toBe(true);
      expect(outputText(result)).toContain("INTERPRETER_UNAVAILABLE");
      expect(harnessed.bashCalls.calls).toBe(0);
      expect(harnessed.env.execCalls).toEqual([]);
    });

    it("uses Windows PowerShell without Git Bash and runs only it", async () => {
      const windowsPowerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
      const harnessed = harness({
        platform: "win32",
        files: [windowsPowerShell],
        trusted: true,
      });
      const token = approve(harnessed, "Get-Location", windowsPowerShell);

      const bash = await harnessed.commands.execute("bash", { command: "ls" }, {}, {});
      const powershell = await harnessed.commands.execute(
        "powershell",
        { command: "Get-Location" },
        {},
        { approvalToken: token }
      );

      expect(bash.isError).toBe(true);
      expect(outputText(bash)).toContain("INTERPRETER_UNAVAILABLE");
      expect(powershell.isError).toBeFalsy();
      expect(harnessed.powershellCalls.calls).toBe(1);
      expect(harnessed.env.execCalls[0].command).toEqual([
        windowsPowerShell,
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Location",
      ]);
    });

    it("requires a fresh approval for every trusted command and never auto-runs", async () => {
      const harnessed = harness({ trusted: true });
      const token = approve(harnessed);

      const unapproved = await harnessed.commands.execute("bash", { command: "echo hi" }, {}, {});
      const auto = await harnessed.commands.execute(
        "bash",
        { command: "echo hi" },
        {},
        { autoApproved: true }
      );
      const approvedOnce = await harnessed.commands.execute(
        "bash",
        { command: "echo hi" },
        {},
        { approvalToken: token }
      );
      const replayed = await harnessed.commands.execute(
        "bash",
        { command: "echo hi" },
        {},
        { approvalToken: token }
      );

      expect(unapproved.isError).toBe(true);
      expect(outputText(unapproved)).toContain("CONFIRMATION_REQUIRED");
      expect(auto.isError).toBe(true);
      expect(outputText(auto)).toContain("AUTO_MODE_CANNOT_BYPASS_STRICT");
      expect(approvedOnce.isError).toBeFalsy();
      expect(replayed.isError).toBe(true);
      expect(outputText(replayed)).toContain("APPROVAL_REQUIRED");
      expect(harnessed.env.execCalls).toHaveLength(1);
    });

    it("denies strict execution and auto bypass with zero process calls", async () => {
      const harnessed = harness();

      const strict = await harnessed.commands.execute("bash", { command: "echo hi" }, {}, {});
      const auto = await harnessed.commands.execute(
        "bash",
        { command: "echo hi" },
        {},
        { autoApproved: true }
      );

      expect(outputText(strict)).toContain("OPAQUE_EXECUTION_DISABLED");
      expect(outputText(auto)).toContain("OPAQUE_EXECUTION_DISABLED");
      expect(harnessed.bashCalls.calls).toBe(0);
      expect(harnessed.env.execCalls).toEqual([]);
    });

    it("injects the absolute interpreter and clamps a long timeout", async () => {
      const harnessed = harness({ trusted: true });
      const token = approve(harnessed, "echo hi", "/bin/bash", 300_000);

      await harnessed.commands.execute(
        "bash",
        { command: "echo hi", timeout: 9_999_999 },
        {},
        { approvalToken: token }
      );

      const call = harnessed.env.execCalls[0];
      expect(call.command).toEqual(["/bin/bash", "-lc", "echo hi"]);
      expect(call.options).toMatchObject({ inheritEnv: false, timeout: 300 });
    });

    it("uses a user-configured absolute interpreter path", async () => {
      const harnessed = harness({
        files: ["/bin/bash", "/opt/tools/bash"],
        configured: { bash: "/opt/tools/bash" },
        trusted: true,
      });
      const token = approve(harnessed, "echo hi", "/opt/tools/bash");

      await harnessed.commands.execute(
        "bash",
        { command: "echo hi" },
        {},
        { approvalToken: token }
      );

      expect(harnessed.env.execCalls[0].command).toEqual(["/opt/tools/bash", "-lc", "echo hi"]);
    });

    it("rejects a command that names a vault target before spawning", async () => {
      const harnessed = harness({ trusted: true });

      const result = await harnessed.commands.execute(
        "bash",
        { command: "cat /vault/notes/a.md" },
        {},
        {}
      );

      expect(result.isError).toBe(true);
      expect(outputText(result)).toContain("VAULT_TARGET_IN_COMMAND");
      expect(harnessed.env.execCalls).toEqual([]);
    });

    it("keeps a native shell error as an error result", async () => {
      const harnessed = harness({ trusted: true, nativeFail: true });
      const token = approve(harnessed);

      const result = await harnessed.commands.execute(
        "bash",
        { command: "echo hi" },
        {},
        { approvalToken: token }
      );

      expect(result.isError).toBe(true);
      expect(outputText(result)).toContain("command failed");
    });
  });

  describe("loadOfficialNativeCommandRegistrations()", () => {
    it("exposes the official bash and powershell factory loader", () => {
      expect(typeof loadOfficialNativeCommandRegistrations).toBe("function");
    });
  });

  describe("capabilityStatus()", () => {
    it("never offers a node interpreter or a PATH fallback", async () => {
      const harnessed = harness();

      const status = await harnessed.commands.capabilityStatus();

      expect(Object.keys(status.commands)).toEqual(["bash", "powershell"]);
      expect(harnessed.resolver.candidatePaths("bash")).not.toContain(process.execPath);
      expect(harnessed.resolver.candidatePaths("bash")).not.toContain("bash");
      expect(JSON.stringify(status)).not.toContain("node");
    });
  });
});
