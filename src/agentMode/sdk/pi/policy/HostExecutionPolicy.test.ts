import * as path from "node:path";

import {
  HostExecutionPolicy,
  type HostCommandRequest,
} from "@/agentMode/sdk/pi/policy/HostExecutionPolicy";

// strict is the default and no execution mode can bypass it: opaque commands are denied without
// spawning anything. trusted_host only opens after a real user acknowledges the non-sandbox risk,
// every command still needs its own concrete confirmation (no allow-always), auto mode cannot skip
// it, a settings change/revoke invalidates unused confirmations, and known vault targets stay
// rejected:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
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

function enableTrustedHost(policy: HostExecutionPolicy): void {
  const result = policy.confirmTrustedHost({
    confirmedBy: "user",
    riskAcknowledged: true,
    noticeVersion: 1,
  });
  if (!result.ok) throw new Error(result.code);
}

describe("HostExecutionPolicy", () => {
  describe("evaluate()", () => {
    it("denies opaque execution in the default strict mode without spawning", async () => {
      const harnessed = harness();

      const decision = await harnessed.policy.runIfAllowed(
        { command: "cat /home/user/notes.md" },
        harnessed.runner
      );
      const auto = await harnessed.policy.runIfAllowed(
        { command: "cat /home/user/notes.md" },
        harnessed.runner,
        { autoApproved: true }
      );

      expect(harnessed.policy.state.mode).toBe("strict");
      expect(decision).toMatchObject({ ran: false, code: "OPAQUE_EXECUTION_DISABLED" });
      expect(auto).toMatchObject({ ran: false, code: "OPAQUE_EXECUTION_DISABLED" });
      expect(harnessed.spawns).toEqual([]);
    });

    it("rejects a settings object that claims trust without a user confirmation", async () => {
      const policy = new HostExecutionPolicy({
        path,
        vaultRoot: "/vault",
        interpreter: { available: true, label: "/bin/bash" },
        initialState: { mode: "trusted_host", trustedConfirmedAtMs: null, settingsVersion: 3 },
        now: () => 1_000,
      });

      const decision = await policy.runIfAllowed({ command: "echo hi" }, async () => undefined);

      expect(decision).toMatchObject({ ran: false, code: "TRUSTED_HOST_NOT_CONFIRMED" });
      expect(policy.state.mode).toBe("trusted_host");
    });

    it("requires a per-command confirmation in trusted_host mode", async () => {
      const harnessed = harness();
      enableTrustedHost(harnessed.policy);

      const decision = await harnessed.policy.runIfAllowed(
        { command: "echo hi", cwd: "/home/user/projects" },
        harnessed.runner
      );
      const auto = await harnessed.policy.runIfAllowed(
        { command: "echo hi", cwd: "/home/user/projects" },
        harnessed.runner,
        { autoApproved: true }
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
      expect(auto).toMatchObject({ ran: false, code: "AUTO_MODE_CANNOT_BYPASS_STRICT" });
      expect(harnessed.spawns).toEqual([]);
    });

    it("runs a trusted command only with the single concrete user approval", async () => {
      const harnessed = harness();
      enableTrustedHost(harnessed.policy);
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
      enableTrustedHost(harnessed.policy);

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
      policy.confirmTrustedHost({ confirmedBy: "user", riskAcknowledged: true, noticeVersion: 1 });

      const decision = await policy.evaluate({ command: "echo hi" });

      expect(decision).toMatchObject({ allowed: false, code: "INTERPRETER_UNAVAILABLE" });
    });
  });

  describe("confirmTrustedHost()", () => {
    it("cannot be enabled by a model or without acknowledging the risk", () => {
      const harnessed = harness();

      expect(
        harnessed.policy.confirmTrustedHost({
          confirmedBy: "model",
          riskAcknowledged: true,
          noticeVersion: 1,
        })
      ).toMatchObject({ ok: false, code: "MODEL_CANNOT_ENABLE_TRUST" });
      expect(
        harnessed.policy.confirmTrustedHost({
          confirmedBy: "user",
          riskAcknowledged: false,
          noticeVersion: 1,
        })
      ).toMatchObject({ ok: false, code: "RISK_NOT_ACKNOWLEDGED" });
      expect(harnessed.policy.state.mode).toBe("strict");
    });

    it("enables trusted_host only after a user acknowledgement and bumps the settings version", () => {
      const harnessed = harness();
      const before = harnessed.policy.state.settingsVersion;

      enableTrustedHost(harnessed.policy);

      expect(harnessed.policy.state.mode).toBe("trusted_host");
      expect(harnessed.policy.state.trustedConfirmedAtMs).toBe(1_000);
      expect(harnessed.policy.state.settingsVersion).toBe(before + 1);
    });
  });

  describe("settings changes", () => {
    it("revokes an unused command approval when trusted_host is disabled", async () => {
      const harnessed = harness();
      enableTrustedHost(harnessed.policy);
      const request: HostCommandRequest = { command: "echo hi" };
      const approved = harnessed.policy.approveCommand(request, { approvedByUser: true });
      if (!approved.ok) throw new Error(approved.code);

      harnessed.policy.disableTrustedHost();
      const decision = await harnessed.policy.runIfAllowed(request, harnessed.runner, {
        approvalToken: approved.token,
      });

      expect(harnessed.policy.state.mode).toBe("strict");
      expect(decision).toMatchObject({ ran: false, code: "STALE_APPROVAL" });
      expect(harnessed.spawns).toEqual([]);
    });
  });

  describe("riskNotice()", () => {
    it("states that trusted execution is not a sandbox", () => {
      const harnessed = harness();

      const notice = harnessed.policy.riskNotice();

      expect(notice).toContain("not a sandbox");
      expect(notice).toContain("current OS account");
      expect(notice).toContain("vault");
    });
  });
});
