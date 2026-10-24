import * as path from "node:path";

import {
  HostExecutionPolicy,
  type HostCommandRequest,
} from "@/agentMode/sdk/pi/policy/HostExecutionPolicy";

// Commands are always offered and the per-command approval is the only gate: every command needs
// its own single-use confirmation (no allow-always, no mode bypass), known vault targets stay
// rejected, and a missing interpreter disables the capability:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
function harness(): {
  readonly policy: HostExecutionPolicy;
  readonly spawns: string[];
  readonly runner: (request: HostCommandRequest) => Promise<void>;
} {
  const policy = new HostExecutionPolicy({
    path,
    vaultRoot: "/vault",
    interpreter: { available: true, label: "/bin/bash" },
    now: () => 1_000,
  });
  const spawns: string[] = [];
  const runner = async (request: HostCommandRequest): Promise<void> => {
    spawns.push(typeof request.command === "string" ? request.command : request.command.join(" "));
  };
  return { policy, spawns, runner };
}

describe("HostExecutionPolicy", () => {
  describe("evaluate()", () => {
    it("requires a per-command confirmation without any pre-enabled mode", async () => {
      const harnessed = harness();

      const decision = await harnessed.policy.runIfAllowed(
        { command: "echo hi", cwd: "/home/user/projects" },
        harnessed.runner
      );

      expect(decision).toMatchObject({ ran: false, code: "CONFIRMATION_REQUIRED" });
      if (decision.ran === false) {
        expect(decision.confirmation).toMatchObject({
          command: "echo hi",
          cwd: "/home/user/projects",
          interpreter: "/bin/bash",
          timeoutMs: 60_000,
          outputLimitBytes: 64 * 1024,
        });
        expect(decision.confirmation?.nonSandboxNotice).toContain("not a sandbox");
      }
      expect(harnessed.spawns).toEqual([]);
    });

    it("runs a command only with the single concrete user approval", async () => {
      const harnessed = harness();
      const request: HostCommandRequest = { command: "echo hi", cwd: "/home/user/projects" };
      const approved = harnessed.policy.approveCommand(request, { approvedByUser: true });
      if (!approved.ok) throw new Error(approved.code);

      const first = await harnessed.policy.runIfAllowed(request, harnessed.runner, {
        approvalToken: approved.token,
      });
      const second = await harnessed.policy.runIfAllowed(request, harnessed.runner, {
        approvalToken: approved.token,
      });

      expect(first).toMatchObject({ ran: true });
      expect(second).toMatchObject({ ran: false, code: "APPROVAL_REQUIRED" });
      expect(harnessed.spawns).toEqual(["echo hi"]);
    });

    it("rejects a command that names a vault target", async () => {
      const harnessed = harness();

      const stringCommand = await harnessed.policy.evaluate({
        command: "cat /vault/notes/a.md",
      });
      const arrayCommand = await harnessed.policy.evaluate({
        command: ["/bin/bash", "-c", "cd /vault"],
      });

      expect(stringCommand).toMatchObject({
        allowed: false,
        code: "VAULT_TARGET_IN_COMMAND",
      });
      expect(arrayCommand).toMatchObject({
        allowed: false,
        code: "VAULT_TARGET_IN_COMMAND",
      });
    });

    it("reports a missing interpreter instead of running", async () => {
      const policy = new HostExecutionPolicy({
        path,
        vaultRoot: "/vault",
        interpreter: { available: false },
        now: () => 1_000,
      });

      const decision = await policy.evaluate({ command: "echo hi" });

      expect(decision).toMatchObject({ allowed: false, code: "INTERPRETER_UNAVAILABLE" });
    });

    it("refuses an expired approval (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", async () => {
      let clock = 1_000;
      const policy = new HostExecutionPolicy({
        path,
        vaultRoot: "/vault",
        interpreter: { available: true, label: "/bin/bash" },
        now: () => clock,
      });
      const request: HostCommandRequest = { command: "echo hi" };
      const approved = policy.approveCommand(request, { approvedByUser: true });
      if (!approved.ok) throw new Error(approved.code);

      clock += 3 * 60 * 1_000;
      const decision = await policy.evaluate(request, { approvalToken: approved.token });

      expect(decision).toMatchObject({ allowed: false, code: "STALE_APPROVAL" });
    });
  });

  describe("approveCommand()", () => {
    it("cannot be approved by anything but a real user confirmation", () => {
      const harnessed = harness();

      expect(
        harnessed.policy.approveCommand({ command: "echo hi" }, { approvedByUser: false })
      ).toMatchObject({ ok: false, code: "MODEL_CANNOT_APPROVE" });
    });

    it("refuses to approve a command that names a vault target", () => {
      const harnessed = harness();

      expect(
        harnessed.policy.approveCommand(
          { command: "cat /vault/notes/a.md" },
          { approvedByUser: true }
        )
      ).toMatchObject({ ok: false, code: "VAULT_TARGET_IN_COMMAND" });
    });
  });

  describe("riskNotice()", () => {
    it("states that host execution is not a sandbox", () => {
      const harnessed = harness();

      const notice = harnessed.policy.riskNotice();

      expect(notice).toContain("not a sandbox");
      expect(notice).toContain("current OS account");
      expect(notice).toContain("vault");
    });
  });
});
