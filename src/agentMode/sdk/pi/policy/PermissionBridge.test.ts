import { ApprovalStore, type ApprovalBindingInput } from "@/agentMode/sdk/pi/policy/ApprovalStore";
import {
  PermissionBridge,
  type PermissionBridgeRequest,
} from "@/agentMode/sdk/pi/policy/PermissionBridge";
import type { PermissionDecision, PermissionPrompt, SessionId } from "@/agentMode/session/types";

// The bridge turns an approval binding into the existing permission prompt without redesigning it:
// a selected allow option is persisted before execution, a rejection has no effect, reopening the
// same requestId keeps exactly one prompt, the first valid decision from any window wins, a missing
// prompter fails closed, and Stop removes the waiter instead of treating the closed dialog as
// approval:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const SESSION_ID = "session-1" as SessionId;

function prompt(overrides: Partial<PermissionPrompt> = {}): PermissionPrompt {
  return {
    sessionId: SESSION_ID,
    toolCall: { toolCallId: "tool-call-1", title: "Write a note", kind: "other" },
    options: [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ],
    ...overrides,
  };
}

function bindingInput(overrides: Partial<ApprovalBindingInput> = {}): ApprovalBindingInput {
  return {
    approvalId: "approval-1",
    toolId: "vault_write",
    schemaHash: "schema-1",
    arguments: { path: "Notes/a.md" },
    targets: ["/vault/Notes/a.md"],
    beforeHash: "before-1",
    scopeVersion: 1,
    policyVersion: 1,
    ...overrides,
  };
}

function bridgeRequest(overrides: Partial<PermissionBridgeRequest> = {}): PermissionBridgeRequest {
  return {
    requestId: "request-1",
    prompt: prompt(),
    bindingInput: bindingInput(),
    intentId: "intent-1",
    ...overrides,
  };
}

function selected(optionId: string): PermissionDecision {
  return { outcome: { outcome: "selected", optionId } };
}

describe("PermissionBridge", () => {
  describe("requestDecision()", () => {
    it("persists the selected decision before executing and returns approved", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      const executionLog: string[] = [];
      const bridge = new PermissionBridge({
        store,
        prompter: async () => selected("allow-once"),
        onApproved: async () => {
          const persisted = store.peek("approval-1");
          executionLog.push(persisted?.kind === "allow_once" ? "decided" : "missing");
          executionLog.push(persisted?.consumed === true ? "consumed" : "not-consumed");
        },
      });
      bridge.register(bridgeRequest());

      const result = await bridge.requestDecision("request-1");

      expect(result).toMatchObject({
        status: "approved",
        requestId: "request-1",
        approvalId: "approval-1",
      });
      expect(executionLog).toEqual(["decided", "consumed"]);
      expect(store.status("approval-1", snapshot())).toBe("consumed");
    });

    it("has no effect when the prompt is rejected", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      let executed = false;
      const bridge = new PermissionBridge({
        store,
        prompter: async () => selected("reject"),
        onApproved: () => {
          executed = true;
        },
      });
      bridge.register(bridgeRequest());

      const result = await bridge.requestDecision("request-1");

      expect(result).toMatchObject({ status: "rejected", requestId: "request-1" });
      expect(executed).toBe(false);
      expect(store.peek("approval-1")).toMatchObject({ kind: "reject_once", consumed: false });
    });

    it("keeps exactly one prompt for a remounted request id", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      const prompter = jest.fn(async () => selected("allow-once"));
      const bridge = new PermissionBridge({ store, prompter });
      bridge.register(bridgeRequest());
      bridge.register(bridgeRequest());

      const [first, second] = await Promise.all([
        bridge.requestDecision("request-1"),
        bridge.requestDecision("request-1"),
      ]);

      expect(prompter).toHaveBeenCalledTimes(1);
      expect(bridge.pendingCount()).toBe(0);
      expect(first).toEqual(second);
      expect(store.peek("approval-1")).toBeDefined();
    });

    it("fails closed without a prompter", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      const bridge = new PermissionBridge({ store });
      bridge.register(bridgeRequest());

      const result = await bridge.requestDecision("request-1");

      expect(result).toMatchObject({
        status: "unavailable",
        code: "APPROVAL_UNAVAILABLE",
        requestId: "request-1",
      });
      expect(store.peek("approval-1")).toBeUndefined();
    });
  });

  describe("submit()", () => {
    it("executes only once when two windows submit different options", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      let approvedCount = 0;
      const bridge = new PermissionBridge({
        store,
        onApproved: () => {
          approvedCount += 1;
        },
      });
      bridge.register(bridgeRequest());

      expect(bridge.submit("request-1", "allow-once")).toBe(true);
      expect(bridge.submit("request-1", "reject")).toBe(false);
      const result = await bridge.requestDecision("request-1");

      expect(result).toMatchObject({ status: "approved" });
      expect(approvedCount).toBe(1);
      expect(store.peek("approval-1")).toMatchObject({ kind: "allow_once", consumed: true });
    });

    it("rejects an option id that is not part of the prompt", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      const bridge = new PermissionBridge({ store });
      bridge.register(bridgeRequest());

      expect(bridge.submit("request-1", "fabricated")).toBe(false);
      expect(store.peek("approval-1")).toBeUndefined();
    });
  });

  describe("cancel()", () => {
    it("removes the waiter on Stop instead of treating the closed prompt as approval", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      let resolvePrompt: ((decision: PermissionDecision) => void) | undefined;
      const bridge = new PermissionBridge({
        store,
        prompter: () =>
          new Promise<PermissionDecision>((resolve) => {
            resolvePrompt = resolve;
          }),
      });
      bridge.register(bridgeRequest());
      const pending = bridge.requestDecision("request-1");
      bridge.cancel("request-1");

      const result = await pending;
      expect(result).toMatchObject({ status: "cancelled" });
      resolvePrompt?.(selected("allow-once"));
      await Promise.resolve();
      expect(store.peek("approval-1")).toBeUndefined();
      expect(bridge.submit("request-1", "allow-once")).toBe(false);
    });
  });
});

function snapshot() {
  const input = bindingInput();
  return {
    schemaHash: input.schemaHash,
    arguments: input.arguments,
    targets: input.targets,
    beforeHash: input.beforeHash,
    scopeVersion: input.scopeVersion,
    policyVersion: input.policyVersion,
  };
}
