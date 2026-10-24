import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  BackendProcess,
  PermissionPrompt,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { lookupToolSummary } from "@/agentMode/ui/toolSummaries";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));

describe("AgentChatUIState", () => {
  describe("getActiveBackgroundTaskCount()", () => {
    it("shows the authoritative background count without changing the main turn or starting work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      let count = 2;
      const chat = new AgentChatUIState({
        subscribe: jest.fn(),
        getActiveBackgroundTaskCount: () => count,
      } as unknown as AgentSession);
      expect(chat.getActiveBackgroundTaskCount()).toBe(2);
      count = 0;
      expect(chat.getActiveBackgroundTaskCount()).toBe(0);
    });
  });
  describe("canSteer()", () => {
    it("exposes the session's active-work capability https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const chat = new AgentChatUIState({
        subscribe: jest.fn(),
        canSteer: () => true,
      } as unknown as AgentSession);
      expect(chat.canSteer()).toBe(true);
    });
  });
  describe("steerMessage()", () => {
    it("awaits the same session's supplemental input without sending a separate turn https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const steerPrompt = jest.fn(async () => undefined);
      const sendPrompt = jest.fn();
      const chat = new AgentChatUIState({
        subscribe: jest.fn(),
        steerPrompt,
        sendPrompt,
      } as unknown as AgentSession);
      await chat.steerMessage("保留原文");
      expect(steerPrompt).toHaveBeenCalledWith("保留原文");
      expect(sendPrompt).not.toHaveBeenCalled();
    });
  });
  describe("pause()", () => {
    it("waits for the session's saved pause without replacing it with cancel https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const pause = jest.fn(async () => undefined);
      const chat = new AgentChatUIState({ subscribe: jest.fn(), pause } as unknown as AgentSession);
      await chat.pause();
      expect(pause).toHaveBeenCalledTimes(1);
    });
  });

  describe("readSubagentHistory()", () => {
    it("returns only the selected saved child's messages without sending a message https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const history = [
        {
          id: "saved-child",
          sender: "ai",
          message: "Saved answer",
          isVisible: true,
          timestamp: null,
        },
      ];
      const readSubagentHistory = jest.fn(async () => history);
      const sendMessage = jest.fn();
      const chat = new AgentChatUIState({
        subscribe: jest.fn(),
        readSubagentHistory,
        sendMessage,
      } as unknown as AgentSession);
      expect(await chat.readSubagentHistory("child-7")).toBe(history);
      expect(readSubagentHistory).toHaveBeenCalledWith("child-7");
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("revertFileChange()", () => {
    it("returns the selected change's confirmed host result https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const change = {
        path: "notes/a.md",
        status: "modified" as const,
        before: "old",
        after: "new",
        additions: 1,
        deletions: 1,
        mutationOperationIds: ["write-1"],
      };
      const result = { ok: false, code: "CONFLICT" };
      const revertFileChange = jest.fn(async () => result);
      const chat = new AgentChatUIState({
        subscribe: jest.fn(),
        revertFileChange,
      } as unknown as AgentSession);
      expect(await chat.revertFileChange(change)).toBe(result);
      expect(revertFileChange).toHaveBeenCalledWith(change);
    });
  });

  describe("getRecoveryState()", () => {
    it("reads the session's actual recovery state without starting work", () => {
      const recovery = { status: "available" };
      const recoverSession = jest.fn();
      const chat = new AgentChatUIState({
        subscribe: jest.fn(),
        getRecoveryState: () => recovery,
        recoverSession,
      } as unknown as AgentSession);
      expect(chat.getRecoveryState()).toBe(recovery);
      expect(recoverSession).not.toHaveBeenCalled();
    });
  });

  describe("recoverSession()", () => {
    it("forwards only the user's chosen action and waits for the session's recovery", async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const recoverSession = jest.fn(() => pending);
      const chat = new AgentChatUIState({
        subscribe: jest.fn(),
        recoverSession,
      } as unknown as AgentSession);

      const result = chat.recoverSession("abort");
      expect(recoverSession).toHaveBeenCalledWith("abort");
      finish();
      await result;
    });
  });

  describe("resumeFanout()", () => {
    it("forwards the selected saved card to the session and waits for completion", async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const resumeFanout = jest.fn(() => pending);
      const chat = new AgentChatUIState({
        subscribe: jest.fn(),
        resumeFanout,
      } as unknown as AgentSession);
      const result = chat.resumeFanout("saved-card");
      expect(resumeFanout).toHaveBeenCalledWith("saved-card");
      finish();
      await result;
    });
  });
  function planReview({ permissionArrived = true }: { permissionArrived?: boolean } = {}) {
    let emitUpdate: SessionUpdateHandler | undefined;
    let finishFirstTurn: ((result: { stopReason: "end_turn" }) => void) | undefined;
    const prompt = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstTurn = resolve;
          })
      )
      .mockResolvedValue({ stopReason: "end_turn" });
    const backend = {
      isRunning: () => true,
      onExit: () => () => undefined,
      registerSessionHandler: (_id: string, handler: SessionUpdateHandler) => {
        emitUpdate = handler;
        return () => undefined;
      },
      prompt,
    } as unknown as BackendProcess;
    const session = new AgentSession({
      backend,
      backendSessionId: "pi-session",
      internalId: "plan-review",
      backendId: "pi",
    });
    session.completeResume({
      model: null,
      mode: {
        current: "plan",
        options: [{ value: "plan", label: "Plan" }],
        apply: {},
      },
    });
    const chat = new AgentChatUIState(session);
    const firstTurn = chat.sendMessage("Draft a plan").turn;
    const request: PermissionPrompt = {
      sessionId: "pi-session",
      toolCall: {
        toolCallId: "plan-review-tool",
        title: "Implement this plan?",
        kind: "switch_mode",
        status: "pending",
        rawInput: { plan: "# Draft plan" },
        isPlanProposal: true,
      },
      options: [
        { optionId: "implement_plan", name: "Implement", kind: "allow_once" },
        { optionId: "revise_plan", name: "Revise", kind: "reject_once" },
      ],
    };
    emitUpdate!({
      sessionId: "pi-session",
      update: { sessionUpdate: "tool_call", ...request.toolCall },
    });
    const permission = permissionArrived
      ? session.handlePlanProposalPermission(request)
      : new Promise<never>(() => undefined);
    const plan = chat.getCurrentPlan();
    if (!plan) throw new Error("Expected a pending plan");
    return {
      chat,
      session,
      plan,
      permission,
      request,
      prompt,
      firstTurn,
      finishFirstTurn: () => finishFirstTurn!({ stopReason: "end_turn" }),
    };
  }

  describe("resolvePlanProposal()", () => {
    it.each([
      ["approve", "Approved plan"],
      ["reject", "Rejected plan"],
      ["feedback", "Requested plan changes: revise step two"],
    ] as const)(
      "shows the user's %s decision in the transcript (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)",
      async (decision, expected) => {
        const review = planReview();
        await review.chat.resolvePlanProposal(review.plan.id, decision, "revise step two");
        const part = review.chat
          .getMessages()
          .flatMap((message) => message.parts ?? [])
          .find((item) => item.kind === "tool_call" && item.id === "plan-review-tool");
        expect(part?.kind).toBe("tool_call");
        if (part?.kind === "tool_call") {
          expect(lookupToolSummary(part).collapsedLine(part, { vaultBase: null })).toBe(expected);
        }
        review.finishFirstTurn();
        await review.firstTurn;
      }
    );
    it("keeps permission-message feedback in the original turn for adapters that consume it", async () => {
      const review = planReview();
      await review.chat.resolvePlanProposal(review.plan.id, "feedback", "revise step two");
      expect((await review.permission).denyMessage).toBe("revise step two");
      review.finishFirstTurn();
      await review.firstTurn;
      expect(review.prompt).toHaveBeenCalledTimes(1);
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 ignores a decision made before the plan permission arrives and keeps the card reviewable", async () => {
      const review = planReview({ permissionArrived: false });
      await review.chat.resolvePlanProposal(review.plan.id, "approve");
      expect(review.chat.getCurrentPlan()?.id).toBe(review.plan.id);

      const permission = review.session.handlePlanProposalPermission(review.request);
      await review.chat.resolvePlanProposal(review.plan.id, "approve");
      expect((await permission).outcome).toEqual({
        outcome: "selected",
        optionId: "implement_plan",
      });
      review.finishFirstTurn();
      await review.firstTurn;
    });

    it.each(["approve", "reject"] as const)(
      "settles %s without starting a follow-up turn",
      async (decision) => {
        const review = planReview();
        await review.chat.resolvePlanProposal(review.plan.id, decision);
        const permission = await review.permission;
        expect(permission.outcome).toEqual({
          outcome: "selected",
          optionId: decision === "approve" ? "implement_plan" : "revise_plan",
        });
        review.finishFirstTurn();
        await review.firstTurn;
        expect(review.prompt).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe("resolveAskUserQuestion()", () => {
    it("shows the selected answer in the transcript (https://github.com/Brevilabs/obsidian-copilot-private/issues/551)", async () => {
      const review = planReview();
      const answer = review.session.handleAskUserQuestion({
        sessionId: "pi-session",
        requestId: "question-one",
        questions: [{ question: "Format: choose one", options: [{ label: "Checklist" }] }],
      });
      review.chat.resolveAskUserQuestion("question-one", { "Format: choose one": "Checklist" });
      await answer;
      const part = review.chat
        .getMessages()
        .flatMap((message) => message.parts ?? [])
        .find((item) => item.kind === "tool_call" && item.id === "question-one");
      expect(part?.kind).toBe("tool_call");
      if (part?.kind === "tool_call") {
        expect(lookupToolSummary(part).collapsedLine(part, { vaultBase: null })).toBe(
          "Answered: Checklist"
        );
      }
      review.finishFirstTurn();
      await review.firstTurn;
    });
  });

  function feedbackChat(): AgentChatUIState {
    const session = new AgentSession({
      backend: {
        isRunning: () => true,
        onExit: () => () => undefined,
        registerSessionHandler: () => () => undefined,
      } as unknown as BackendProcess,
      backendSessionId: "s-1",
      internalId: "feedback",
      backendId: "pi",
    });
    session.completeResume(null);
    const chat = new AgentChatUIState(session);
    session.offerFeedback({ title: "t", whatHappened: "w", userSaid: "", repro: "r" });
    return chat;
  }

  describe("getFeedbackOffer()", () => {
    it("serves the session's open feedback card", () => {
      expect(feedbackChat().getFeedbackOffer()?.status).toBe("open");
    });
  });

  describe("dismissFeedbackOffer()", () => {
    it("dismisses the session's open card and notifies the view", () => {
      const chat = feedbackChat();
      const listener = jest.fn();
      chat.subscribe(listener);

      chat.dismissFeedbackOffer();

      expect(chat.getFeedbackOffer()?.status).toBe("dismissed");
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("markFeedbackReported()", () => {
    it("records the sent report on the session's card", () => {
      const chat = feedbackChat();

      chat.markFeedbackReported({ reportId: "r1", issueUrl: "https://example.com" });

      expect(chat.getFeedbackOffer()).toMatchObject({
        status: "reported",
        report: { reportId: "r1", issueUrl: "https://example.com" },
      });
    });
  });

  describe("isTurnInFlight()", () => {
    it("stays true while an approved plan is being implemented and clears when the turn finishes (https://github.com/Brevilabs/obsidian-copilot-private/issues/41)", async () => {
      const review = planReview();
      expect(review.chat.isTurnInFlight()).toBe(true);

      await review.chat.resolvePlanProposal(review.plan.id, "approve");
      await review.permission;
      expect(review.chat.isTurnInFlight()).toBe(true);

      review.finishFirstTurn();
      await review.firstTurn;
      expect(review.chat.isTurnInFlight()).toBe(false);
    });
  });
});
