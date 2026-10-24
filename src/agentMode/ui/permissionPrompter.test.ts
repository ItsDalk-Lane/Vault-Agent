import type { AgentSession } from "@/agentMode/session/AgentSession";
import {
  PERMISSION_OPTION_KINDS,
  type AgentToolKind,
  type PermissionPrompt,
} from "@/agentMode/session/types";
import { createDefaultPermissionPrompter } from "./permissionPrompter";

function promptFor(sessionId: string, kind: AgentToolKind): PermissionPrompt {
  return {
    sessionId,
    toolCall: { toolCallId: "t1", title: "tool", kind, status: "pending" },
    options: PERMISSION_OPTION_KINDS.map((k) => ({ optionId: k, name: k, kind: k })),
  };
}

describe("permissionPrompter", () => {
  describe("createDefaultPermissionPrompter()", () => {
    it("allows read/search/fetch tools for a read-only fan-out sub-session without a card", async () => {
      const handleToolPermission = jest.fn();
      const session = { handleToolPermission } as unknown as AgentSession;
      const prompter = createDefaultPermissionPrompter(
        () => session,
        (id) => id === "ro-session"
      );

      for (const kind of ["read", "search", "fetch", "execute"] as AgentToolKind[]) {
        const decision = await prompter(promptFor("ro-session", kind));
        expect(decision.outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
      }
      expect(handleToolPermission).not.toHaveBeenCalled();
    });

    it("denies vault-write tools for a read-only fan-out sub-session", async () => {
      const prompter = createDefaultPermissionPrompter(
        () => null,
        () => true
      );
      for (const kind of ["edit", "delete", "move", "other"] as AgentToolKind[]) {
        const decision = await prompter(promptFor("ro-session", kind));
        expect(decision.outcome).toEqual({ outcome: "selected", optionId: "reject_once" });
        expect(decision.denyMessage).toContain("Read-only");
      }
    });

    it("routes a normal (non-fan-out) session to its inline permission card", async () => {
      const handleToolPermission = jest
        .fn()
        .mockResolvedValue({ outcome: { outcome: "cancelled" } });
      const session = { handleToolPermission } as unknown as AgentSession;
      const prompter = createDefaultPermissionPrompter(
        () => session,
        () => false
      );
      await prompter(promptFor("normal", "edit"));
      expect(handleToolPermission).toHaveBeenCalledTimes(1);
    });

    it("does not reinterpret an unmarked legacy mode command as an executable plan https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const handleToolPermission = jest
        .fn()
        .mockResolvedValue({ outcome: { outcome: "cancelled" } });
      const handlePlanProposalPermission = jest.fn();
      const session = {
        handleToolPermission,
        handlePlanProposalPermission,
      } as unknown as AgentSession;
      const request = promptFor("pi", "switch_mode");
      request.toolCall.rawInput = { plan: "Old protocol data" };
      await createDefaultPermissionPrompter(() => session)(request);
      expect(handleToolPermission).toHaveBeenCalledWith(request);
      expect(handlePlanProposalPermission).not.toHaveBeenCalled();
    });

    it("routes an explicitly marked built-in plan review to its plan card https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const handlePlanProposalPermission = jest
        .fn()
        .mockResolvedValue({ outcome: { outcome: "cancelled" } });
      const handleToolPermission = jest.fn();
      const session = {
        handlePlanProposalPermission,
        handleToolPermission,
      } as unknown as AgentSession;
      const prompter = createDefaultPermissionPrompter(() => session);
      const request = promptFor("pi", "other");
      request.toolCall.isPlanProposal = true;
      request.toolCall.rawInput = { plan: "# Build the note" };

      await prompter(request);

      expect(handlePlanProposalPermission).toHaveBeenCalledWith(request);
      expect(handleToolPermission).not.toHaveBeenCalled();
    });
  });
});
