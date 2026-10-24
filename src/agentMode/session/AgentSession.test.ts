import { AI_SENDER, USER_SENDER } from "@/constants";
import { t } from "@/i18n";
import {
  AgentSession,
  buildPromptContext,
  withReadOnlyPreamble,
} from "@/agentMode/session/AgentSession";
import type {
  AgentChatMessage,
  BackendProcess,
  BackendDescriptor,
  BackendState,
  BudgetUpdate,
  RunStateUpdate,
  RecoveryStateUpdate,
  SessionProjection,
  SessionUpdate,
  SessionUpdateHandler,
  TurnFileChange,
  PermissionPrompt,
  AskUserQuestionPrompt,
} from "@/agentMode/session/types";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { FanoutRunInput } from "@/agentMode/session/fanout/FanoutOrchestrator";
import type { MessageContext } from "@/types/message";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));

const SESSION_ID = "pi-session";

// The session consumes the authoritative display projection without losing the UI facts that only
// the host knows: optimistic user ids/context survive a replace, stale frames are dropped, paged
// history prepends, and the old incremental replay path still works:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
interface Harness {
  readonly session: AgentSession;
  readonly backend: BackendProcess;
  emit(update: SessionUpdate): void;
  completeTurn(): void;
}

function createHarness({
  resume = true,
  descriptor,
  runFanoutTurn,
}: {
  resume?: boolean;
  descriptor?: BackendDescriptor;
  runFanoutTurn?: (input: FanoutRunInput) => Promise<FanoutTurn>;
} = {}): Harness {
  let handler: SessionUpdateHandler | undefined;
  let finishPrompt: ((output: { stopReason: "end_turn" }) => void) | undefined;
  const prompt = jest.fn(
    () =>
      new Promise<{ stopReason: "end_turn" }>((resolve) => {
        finishPrompt = resolve;
      })
  );
  const backend = {
    isRunning: () => true,
    onExit: () => () => undefined,
    registerSessionHandler: (_sessionId: string, next: SessionUpdateHandler) => {
      handler = next;
      return () => {
        if (handler === next) handler = undefined;
      };
    },
    prompt,
    cancel: jest.fn(async () => undefined),
    setSessionObserved: jest.fn(),
    recoverSession: jest.fn(async () => undefined),
    setFeedbackStatus: jest.fn(async () => undefined),
    setFeedbackEnabled: jest.fn(async () => undefined),
    listSessions: jest.fn(async () => ({ sessions: [] })),
  } as unknown as BackendProcess;
  const session = new AgentSession({
    backend,
    backendSessionId: SESSION_ID,
    internalId: "projection",
    backendId: "pi",
    getDescriptor: descriptor ? () => descriptor : undefined,
    runFanoutTurn,
  });
  if (resume) session.completeResume(null);
  return {
    session,
    backend,
    emit(update) {
      if (handler === undefined) throw new Error("the session handler is not registered");
      handler({ sessionId: SESSION_ID, update });
    },
    completeTurn() {
      if (finishPrompt === undefined) throw new Error("the prompt was not sent");
      finishPrompt({ stopReason: "end_turn" });
    },
  };
}

function userMessage(
  id: string,
  text: string,
  overrides: Partial<AgentChatMessage> = {}
): AgentChatMessage {
  return { id, sender: USER_SENDER, timestamp: null, isVisible: true, message: text, ...overrides };
}

function assistantMessage(
  id: string,
  text: string,
  overrides: Partial<AgentChatMessage> = {}
): AgentChatMessage {
  return { id, sender: AI_SENDER, timestamp: null, isVisible: true, message: text, ...overrides };
}

function pendingState(): SessionProjection["pending"] {
  return { permissions: [], questions: [], plan: null, recovery: null };
}

function projectionUpdate(
  streamEpoch: string,
  frameIndex: number,
  mode: SessionProjection["mode"],
  messages: readonly AgentChatMessage[]
): SessionUpdate {
  return {
    sessionUpdate: "session_projection",
    projection: { cursor: { streamEpoch, frameIndex }, mode, messages, pending: pendingState() },
  };
}

function runState(overrides: Partial<RunStateUpdate> = {}): SessionUpdate {
  return {
    sessionUpdate: "run_state",
    run: {
      runId: "run-1",
      requestId: "request-1",
      status: "running",
      startedAtMs: 1_000,
      cancelEpoch: 0,
      ...overrides,
    },
  };
}

function budgetUpdate(overrides: Partial<BudgetUpdate> = {}): SessionUpdate {
  return {
    sessionUpdate: "budget_update",
    budget: { source: "unknown", usage: null, updatedAt: 1, ...overrides },
  };
}

function selectedTextContext(): MessageContext {
  return {
    notes: [],
    urls: [],
    selectedTextContexts: [
      {
        id: "selection-1",
        content: "the selected note text",
        sourceType: "note",
        noteTitle: "Note",
        notePath: "Note.md",
        startLine: 1,
        endLine: 2,
      },
    ],
  };
}

function messageIds(session: AgentSession): string[] {
  return session.store.getDisplayMessages().map((message) => message.id);
}

function persistedFeedback(): FeedbackOffer {
  return {
    id: "feedback-persisted",
    draft: {
      title: "Provider failed",
      whatHappened: "Repeated failure",
      userSaid: "",
      repro: "Retry the request",
    },
    evidence: {
      backendId: "pi",
      model: null,
      sessionId: SESSION_ID,
      raisedAt: "2026-10-22T00:00:00Z",
    },
    afterUserMessageId: null,
    status: "open",
  };
}

describe("AgentSession", () => {
  describe("releaseBackendSession()", () => {
    it.each(["waiting", "just_opened"])(
      "releases an initialization in %s state without requiring a prematurely assigned backend identity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (phase) => {
        let signal: AbortSignal | undefined;
        const close = jest.fn(async () => undefined);
        const backend = {
          ...createHarness().backend,
          closeSession: close,
          newSession: (input: { signal?: AbortSignal }) =>
            new Promise((resolve, reject) => {
              signal = input.signal;
              input.signal?.addEventListener(
                "abort",
                () => {
                  if (phase === "just_opened")
                    resolve({ sessionId: "only-own-opening", state: {} });
                  else reject(new Error("opening cancelled"));
                },
                { once: true }
              );
            }),
        } as unknown as BackendProcess;
        const session = AgentSession.start({
          backend,
          internalId: "queued-release",
          backendId: "pi",
          cwd: "/vault",
        });
        await session.releaseBackendSession();
        await session.ready;
        expect(signal?.aborted).toBe(true);
        if (phase === "just_opened")
          expect(close).toHaveBeenCalledWith({ sessionId: "only-own-opening" });
        else expect(close).not.toHaveBeenCalled();
        expect(backend.prompt).not.toHaveBeenCalled();
        await session.dispose();
      }
    );
    it("retains the unsupported-close failure for an actual opened backend that lacks the capability https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      await expect(subject.session.releaseBackendSession()).rejects.toThrow();
    });
  });
  describe("dispose()", () => {
    it("cancels an unfinished new-session opening and waits for its own admission to end without sending a prompt https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let openingSignal: AbortSignal | undefined;
      const backend = {
        ...createHarness().backend,
        newSession: jest.fn(
          (input: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              openingSignal = input.signal;
              input.signal?.addEventListener(
                "abort",
                () => reject(new Error(String(input.signal?.reason ?? "opening cancelled"))),
                {
                  once: true,
                }
              );
            })
        ),
      } as unknown as BackendProcess;
      const session = AgentSession.start({
        backend,
        internalId: "queued-start",
        backendId: "pi",
        cwd: "/vault",
      });
      expect(openingSignal?.aborted).toBe(false);
      await session.dispose();
      await session.ready;
      expect(openingSignal?.aborted).toBe(true);
      expect(session.getStatus()).toBe("closed");
      expect(backend.prompt).not.toHaveBeenCalled();
    });
  });
  describe("getActiveBackgroundTaskCount()", () => {
    it("tracks the current durable child projection without treating an idle parent as running https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const subject = createHarness();
      const changed = jest.fn();
      subject.session.subscribe({ onMessagesChanged: changed, onStatusChanged: () => undefined });
      expect(subject.session.getActiveBackgroundTaskCount()).toBe(0);
      const update = projectionUpdate("children", 1, "replace", []);
      if (update.sessionUpdate !== "session_projection") throw new Error("missing projection");
      update.projection.activeBackgroundTaskIds = ["actual-child-1", "actual-child-2"];
      subject.emit(update);
      expect(subject.session.getActiveBackgroundTaskCount()).toBe(2);
      expect(subject.session.getStatus()).toBe("idle");
      expect(changed).toHaveBeenCalledTimes(1);
      subject.emit(projectionUpdate("children", 2, "prepend", []));
      expect(subject.session.getActiveBackgroundTaskCount()).toBe(2);
      subject.emit(projectionUpdate("children", 3, "replace", []));
      expect(subject.session.getActiveBackgroundTaskCount()).toBe(0);
      expect(changed).toHaveBeenCalledTimes(2);
    });
  });

  describe("cancel()", () => {
    it("stops an idle parent's actual descendants and admits the next input only after that stop settles https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const update = projectionUpdate("children", 1, "replace", []);
      if (update.sessionUpdate !== "session_projection") throw new Error("missing projection");
      update.projection.activeBackgroundTaskIds = ["background-1"];
      subject.emit(update);
      let finishStop!: () => void;
      subject.backend.cancel = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishStop = resolve;
          })
      );
      const stop = subject.session.cancel();
      const duplicateStop = subject.session.cancel();
      const { turn } = subject.session.sendPrompt("A new explicit user request");
      expect(subject.backend.cancel).toHaveBeenCalledTimes(1);
      expect(subject.backend.prompt).not.toHaveBeenCalled();
      finishStop();
      await stop;
      await duplicateStop;
      expect(subject.backend.prompt).toHaveBeenCalledTimes(1);
      subject.completeTurn();
      expect(await turn).toBe("end_turn");
    });

    it("can cancel a newly queued input while the prior background stop is still settling https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const update = projectionUpdate("children", 1, "replace", []);
      if (update.sessionUpdate !== "session_projection") throw new Error("missing projection");
      update.projection.activeBackgroundTaskIds = ["background-1"];
      subject.emit(update);
      let finishStop!: () => void;
      subject.backend.cancel = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishStop = resolve;
          })
      );
      const stop = subject.session.cancel();
      const { turn } = subject.session.sendPrompt("A queued explicit user request");
      const stopNewInput = subject.session.cancel();
      finishStop();
      await stop;
      await stopNewInput;
      expect(subject.backend.cancel).toHaveBeenCalledTimes(1);
      expect(subject.backend.prompt).not.toHaveBeenCalled();
      expect(await turn).toBe("cancelled");
    });

    it("does not stop a settled idle chat without live background work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      await subject.session.cancel();
      expect(subject.backend.cancel).not.toHaveBeenCalled();
    });
  });

  describe("pause()", () => {
    it("asks the runtime to save and pause without cancelling or clearing messages https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harness = createHarness();
      const pauseSession = jest.fn(async () => undefined);
      harness.backend.pauseSession = pauseSession;
      await harness.session.pause();
      expect(pauseSession).toHaveBeenCalledWith({ sessionId: SESSION_ID });
      expect(harness.backend.cancel).not.toHaveBeenCalled();
    });
    it("rejects unsupported historical runtimes without sending a stop https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harness = createHarness();
      await expect(harness.session.pause()).rejects.toThrow("不支持暂停");
      expect(harness.backend.cancel).not.toHaveBeenCalled();
    });
  });

  describe("clearCurrentPlanIfModeLeft()", () => {
    it("still clears a mode-owned plan when its backend leaves plan mode https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const descriptor = {
        planLifecycle: "mode",
        getModeMapping: () => ({
          kind: "setMode",
          canonical: { default: "default", plan: "plan" },
        }),
      } as unknown as BackendDescriptor;
      const subject = createHarness({ descriptor });
      subject.emit({
        sessionUpdate: "state_changed",
        state: {
          model: null,
          mode: {
            current: "default",
            options: [],
            apply: { default: { kind: "setMode", nativeId: "default" } },
          },
        },
      });
      subject.emit({
        sessionUpdate: "plan_proposal_update",
        plan: {
          id: "legacy-plan",
          revision: 1,
          title: "计划",
          body: "正文",
          permissionGated: false,
          decision: "pending",
        },
      });
      subject.session.clearCurrentPlanIfModeLeft();
      expect(subject.session.getCurrentPlan()).toBeNull();
    });
  });
  describe("setConfigOption()", () => {
    it.each(["pi-model", "pi-effort"])(
      "keeps an independently owned pending plan when %s changes in ordinary mode https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (configId) => {
        const descriptor = {
          planLifecycle: "independent",
          getModeMapping: () => ({
            kind: "setMode",
            canonical: { default: "default", plan: "plan" },
          }),
        } as unknown as BackendDescriptor;
        const subject = createHarness({ descriptor });
        const state = {
          model: null,
          mode: {
            current: "default",
            options: [],
            apply: { default: { kind: "setMode", nativeId: "default" } },
          },
        } as BackendState;
        subject.backend.setSessionConfigOption = jest.fn(async () => state);
        subject.backend.decidePendingPlan = jest.fn(async () => undefined);
        const plan = {
          id: "original-plan",
          revision: 3,
          title: "原始标题",
          body: "原始正文",
          permissionGated: true,
          pendingToolCallId: "original-call",
          decision: "pending" as const,
        };
        subject.emit({ sessionUpdate: "plan_proposal_update", plan });
        await subject.session.setConfigOption(configId, "changed");
        expect(subject.session.getCurrentPlan()).toEqual(plan);
        expect(subject.backend.decidePendingPlan).not.toHaveBeenCalled();
      }
    );
  });
  describe("rolloverSession()", () => {
    it("runs the explicit host action without sending a user prompt and returns its new root https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const rollover = jest.fn(async () => ({
        sessionId: "new-root",
        state: { model: null, mode: null },
      }));
      subject.backend.rolloverSession = rollover;
      expect(await subject.session.rolloverSession()).toEqual({
        sessionId: "new-root",
        state: { model: null, mode: null },
      });
      expect(rollover).toHaveBeenCalledWith({ sessionId: SESSION_ID });
      expect(subject.backend.prompt).not.toHaveBeenCalled();
    });

    it("rejects an unsupported or pending chat before calling the rollover host action https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      await expect(subject.session.rolloverSession()).rejects.toMatchObject({
        name: "MethodUnsupportedError",
      });
      const rollover = jest.fn();
      subject.backend.rolloverSession = rollover;
      subject.emit(runState());
      await expect(subject.session.rolloverSession()).rejects.toThrow();
      expect(rollover).not.toHaveBeenCalled();
    });
  });
  describe("handlePlanProposalPermission()", () => {
    it("ignores an already withdrawn plan window without publishing a synthetic pending plan https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const controller = new AbortController();
      controller.abort();
      const request: PermissionPrompt = {
        sessionId: SESSION_ID,
        signal: controller.signal,
        toolCall: {
          toolCallId: "plan-call",
          title: "原计划",
          isPlanProposal: true,
          kind: "switch_mode",
          rawInput: { plan: "原计划" },
        },
        options: [],
      };
      const pending = subject.session.handlePlanProposalPermission(request);
      expect(subject.session.getCurrentPlan()).toBeNull();
      expect(subject.session.hasPendingPlanPermission()).toBe(false);
      expect(await pending).toEqual({ outcome: { outcome: "cancelled" } });
    });

    it("withdraws only the matching plan window without cancelling its saved plan or overwriting a later live approval https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const decide = jest.fn(async () => undefined);
      subject.backend.decidePendingPlan = decide;
      const controller = new AbortController();
      const request: PermissionPrompt = {
        sessionId: SESSION_ID,
        signal: controller.signal,
        toolCall: {
          toolCallId: "plan-call",
          title: "原计划",
          isPlanProposal: true,
          kind: "switch_mode",
          rawInput: { plan: "原计划" },
        },
        options: [{ optionId: "yes", name: "批准", kind: "allow_once" }],
      };
      const previous = subject.session.handlePlanProposalPermission(request);
      const next = subject.session.handlePlanProposalPermission({ ...request, signal: undefined });
      controller.abort();
      expect(subject.session.hasPendingPlanPermission()).toBe(true);
      await subject.session.resolvePlanProposalPermission("plan-call", true);
      expect(await next).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
      expect(await previous).toEqual({ outcome: { outcome: "cancelled" } });
      expect(decide).not.toHaveBeenCalled();
      expect(subject.session.getCurrentPlan()?.decision).toBe("pending");
      await subject.session.dispose();
    });

    it.each(["document-first", "permission-first"] as const)(
      "preserves the canonical plan title, id and revision when %s is replayed https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (order) => {
        const subject = createHarness();
        const plan = {
          id: "canonical-plan",
          revision: 3,
          title: "模型提供的标题",
          body: "# 正文内的不同标题\n\n原始内容",
          decision: "pending" as const,
          permissionGated: true,
          pendingToolCallId: "plan-call",
        };
        const request = {
          sessionId: SESSION_ID,
          toolCall: {
            toolCallId: "plan-call",
            title: plan.title,
            kind: "switch_mode" as const,
            isPlanProposal: true,
            rawInput: { plan: plan.body },
          },
          options: [{ optionId: "approve", name: "批准", kind: "allow_once" as const }],
        };
        let pending: Promise<unknown>;
        if (order === "document-first") {
          subject.emit({ sessionUpdate: "plan_proposal_update", plan });
          pending = subject.session.handlePlanProposalPermission(request);
        } else {
          pending = subject.session.handlePlanProposalPermission(request);
          subject.emit({ sessionUpdate: "plan_proposal_update", plan });
        }
        expect(subject.session.getCurrentPlan()).toEqual(plan);
        await subject.session.resolvePlanProposalPermission("plan-call", true);
        await pending;
      }
    );
  });

  describe("handleToolPermission()", () => {
    it("does not create a card for an already withdrawn live permission https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const controller = new AbortController();
      controller.abort();
      const request: PermissionPrompt = {
        sessionId: SESSION_ID,
        signal: controller.signal,
        toolCall: { toolCallId: "expired-live", title: "修改文件" },
        options: [],
      };
      expect(await subject.session.handleToolPermission(request)).toEqual({
        outcome: { outcome: "cancelled" },
      });
      expect(subject.session.getPendingToolPermissions()).toEqual([]);
      expect(subject.session.getStatus()).toBe("idle");
    });

    it("withdraws only the matching live callback on abort without sending another durable decision https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      subject.backend.decidePermission = jest.fn(async () => undefined);
      const controller = new AbortController();
      const request: PermissionPrompt = {
        sessionId: SESSION_ID,
        signal: controller.signal,
        toolCall: { toolCallId: "live", title: "修改文件" },
        options: [{ optionId: "yes", name: "允许", kind: "allow_once" }],
      };
      const pending = subject.session.handleToolPermission(request);
      expect(subject.session.getPendingToolPermissions()).toEqual([request]);
      expect(subject.session.getStatus()).toBe("awaiting_permission");
      controller.abort();
      expect(await pending).toEqual({ outcome: { outcome: "cancelled" } });
      expect(subject.session.getPendingToolPermissions()).toEqual([]);
      expect(subject.session.getStatus()).toBe("idle");
      expect(subject.backend.decidePermission).not.toHaveBeenCalled();
    });

    it("settles a normal live selection once and ignores cancellation of its replaced callback https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const controller = new AbortController();
      const request: PermissionPrompt = {
        sessionId: SESSION_ID,
        signal: controller.signal,
        toolCall: { toolCallId: "live", title: "修改文件" },
        options: [{ optionId: "yes", name: "允许", kind: "allow_once" }],
      };
      const previous = subject.session.handleToolPermission(request);
      const replacement = { ...request, signal: undefined };
      const pending = subject.session.handleToolPermission(replacement);
      controller.abort();
      expect(await previous).toEqual({ outcome: { outcome: "cancelled" } });
      expect(subject.session.getPendingToolPermissions()).toEqual([replacement]);
      await subject.session.resolveToolPermission("live", "yes");
      expect(await pending).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
      expect(subject.session.getPendingToolPermissions()).toEqual([]);
      expect(subject.session.getStatus()).toBe("idle");
    });
  });

  describe("resolveToolPermission()", () => {
    it("restores original pending cards and saves a click through the backend without starting a prompt https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const decide = jest.fn(async () => undefined);
      subject.backend.decidePermission = decide;
      const request = {
        sessionId: SESSION_ID,
        toolCall: { toolCallId: "saved-call", title: "修改原文" },
        options: [{ optionId: "yes", name: "允许这一次", kind: "allow_once" as const }],
      };
      subject.emit({
        sessionUpdate: "session_projection",
        projection: {
          cursor: { streamEpoch: "reopen", frameIndex: 1 },
          mode: "replace",
          messages: [],
          pending: { ...pendingState(), permissions: [request] },
        },
      });
      expect(subject.session.getPendingToolPermissions()).toEqual([request]);
      await subject.session.resolveToolPermission("saved-call", "yes");
      expect(decide).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        requestId: "saved-call",
        decision: { outcome: { outcome: "selected", optionId: "yes" } },
      });
      expect(subject.backend.prompt).not.toHaveBeenCalled();
      expect(subject.backend.recoverSession).not.toHaveBeenCalled();
    });
  });

  describe("handleAskUserQuestion()", () => {
    it("withdraws only its own question window and never submits a new durable answer during cleanup https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      subject.backend.answerPendingQuestion = jest.fn(async () => undefined);
      const controller = new AbortController();
      const request: AskUserQuestionPrompt = {
        sessionId: SESSION_ID,
        requestId: "live-question",
        signal: controller.signal,
        questions: [{ question: "选择？", answerKey: "choice", options: [{ label: "A" }] }],
      };
      subject.emit({
        sessionUpdate: "session_projection",
        projection: {
          cursor: { streamEpoch: "questions", frameIndex: 1 },
          mode: "replace",
          messages: [],
          pending: { ...pendingState(), questions: [request] },
        },
      });
      const pending = subject.session.handleAskUserQuestion(request);
      await subject.session.resolveAskUserQuestion("live-question", { choice: "A" });
      expect(await pending).toEqual({ choice: "A" });
      controller.abort();
      expect(subject.backend.answerPendingQuestion).not.toHaveBeenCalled();
    });

    it("cancels the old local question callback without removing a newer window for the same request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      subject.backend.answerPendingQuestion = jest.fn(async () => undefined);
      const controller = new AbortController();
      const request: AskUserQuestionPrompt = {
        sessionId: SESSION_ID,
        requestId: "live-question",
        signal: controller.signal,
        questions: [{ question: "选择？", answerKey: "choice", options: [{ label: "A" }] }],
      };
      const old = subject.session.handleAskUserQuestion(request);
      const replacement = { ...request, signal: undefined };
      const pending = subject.session.handleAskUserQuestion(replacement);
      controller.abort();
      expect(subject.session.getPendingAskUserQuestions()).toEqual([replacement]);
      expect(await old).toEqual({});
      await subject.session.resolveAskUserQuestion("live-question", { choice: "A" });
      expect(await pending).toEqual({ choice: "A" });
      expect(subject.session.getPendingAskUserQuestions()).toEqual([]);
      expect(subject.session.getStatus()).toBe("idle");
      expect(subject.backend.answerPendingQuestion).not.toHaveBeenCalled();
    });
  });

  describe("resolveAskUserQuestion()", () => {
    it("saves the original reopened question answer through its backend without calling the model https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const answer = jest.fn(async () => undefined);
      subject.backend.answerPendingQuestion = answer;
      const question = {
        sessionId: SESSION_ID,
        requestId: "saved-question",
        questions: [{ question: "保留哪个？", answerKey: "choice", options: [{ label: "标题" }] }],
      };
      subject.emit({
        sessionUpdate: "session_projection",
        projection: {
          cursor: { streamEpoch: "reopen", frameIndex: 1 },
          mode: "replace",
          messages: [],
          pending: { ...pendingState(), questions: [question] },
        },
      });
      expect(subject.session.getPendingAskUserQuestions()).toEqual([question]);
      await subject.session.resolveAskUserQuestion("saved-question", { choice: "标题" });
      expect(answer).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        requestId: "saved-question",
        answers: { choice: "标题" },
      });
      expect(subject.backend.prompt).not.toHaveBeenCalled();
      expect(subject.backend.recoverSession).not.toHaveBeenCalled();
    });
  });

  describe("resolvePlanProposalPermission()", () => {
    it("saves a reopened plan decision with the original revision without switching mode or starting work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = createHarness();
      const decide = jest.fn(async () => undefined);
      subject.backend.decidePendingPlan = decide;
      const plan = {
        id: "saved-plan",
        revision: 2,
        title: "原始计划",
        body: "原始正文",
        decision: "pending" as const,
        permissionGated: true,
        pendingToolCallId: "plan-call",
      };
      subject.emit({
        sessionUpdate: "session_projection",
        projection: {
          cursor: { streamEpoch: "reopen", frameIndex: 1 },
          mode: "replace",
          messages: [],
          pending: { ...pendingState(), plan },
        },
      });
      expect(subject.session.hasPendingPlanPermission()).toBe(true);
      await subject.session.resolvePlanProposalPermission("plan-call", false, "先核对原文");
      expect(decide).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        planId: "saved-plan",
        revision: 2,
        action: "feedback",
        feedback: "先核对原文",
      });
      expect(subject.backend.prompt).not.toHaveBeenCalled();
      expect(subject.backend.recoverSession).not.toHaveBeenCalled();
    });
  });
  describe("readSubagentHistory()", () => {
    it("reads saved history through the owning ready session without starting a prompt https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend } = createHarness({ resume: false });
      const history = [assistantMessage("child-answer", "Saved child response")];
      backend.readSubagentHistory = jest.fn(async () => history);
      const reading = session.readSubagentHistory("child-7");
      expect(backend.readSubagentHistory).not.toHaveBeenCalled();
      session.completeResume(null);
      expect(await reading).toBe(history);
      expect(backend.readSubagentHistory).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        conversationId: "child-7",
      });
      expect(backend.prompt).not.toHaveBeenCalled();
      expect(session.getStatus()).toBe("idle");
    });

    it("rejects unsupported history and closed chats instead of starting a new child https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend } = createHarness();
      await expect(session.readSubagentHistory("child-7")).rejects.toThrow(
        "Agent does not implement readSubagentHistory"
      );
      backend.readSubagentHistory = jest.fn(async () => []);
      await session.dispose();
      await expect(session.readSubagentHistory("child-7")).rejects.toThrow("此聊天已关闭。");
      expect(backend.readSubagentHistory).not.toHaveBeenCalled();
      expect(backend.prompt).not.toHaveBeenCalled();
    });
  });

  describe("revertFileChange()", () => {
    it("runs a receipt-backed revert without a model call and returns the host result https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend } = createHarness();
      backend.revertFileChange = jest.fn(async () => ({ ok: true }));
      const result = await session.revertFileChange({
        path: "notes/a.md",
        status: "modified",
        before: "old",
        after: "new",
        additions: 1,
        deletions: 1,
        mutationOperationIds: ["write-1", "write-2"],
      });

      expect(result).toEqual({ ok: true });
      expect(backend.revertFileChange).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        operationIds: ["write-1", "write-2"],
        signal: expect.any(AbortSignal),
      });
      expect(backend.prompt).not.toHaveBeenCalled();
      expect(session.getStatus()).toBe("idle");
    });

    it("keeps Stop effective during a pending revert and clears the busy state afterward https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend } = createHarness();
      let started!: () => void;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      backend.revertFileChange = jest.fn(
        ({ signal }) =>
          new Promise((resolve) => {
            signal?.addEventListener("abort", () => resolve({ ok: false, code: "CANCELLED" }), {
              once: true,
            });
            started();
          })
      );
      const pending = session.revertFileChange({
        path: "notes/a.md",
        status: "modified",
        before: "old",
        after: "new",
        additions: 1,
        deletions: 1,
        mutationOperationIds: ["write-1"],
      });
      await began;
      expect(session.getStatus()).toBe("running");
      expect(() => session.sendPrompt("new work")).toThrow();
      await session.cancel();
      expect(await pending).toEqual({ ok: false, code: "CANCELLED" });
      expect(backend.cancel).toHaveBeenCalledWith({ sessionId: SESSION_ID });
      expect(session.getStatus()).toBe("idle");
    });

    it("refuses changes without receipts and read-only historical changes before calling the host https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, emit } = createHarness();
      backend.revertFileChange = jest.fn();
      const change: TurnFileChange = {
        path: "notes/a.md",
        status: "modified",
        before: "old",
        after: "new",
        additions: 1,
        deletions: 1,
      };
      await expect(session.revertFileChange(change)).rejects.toThrow("凭据");
      emit({ sessionUpdate: "state_changed", state: { model: null, mode: null, readOnly: true } });
      await expect(
        session.revertFileChange({ ...change, mutationOperationIds: ["write-1"] })
      ).rejects.toThrow(t("localData.readOnly"));
      expect(backend.revertFileChange).not.toHaveBeenCalled();
    });
  });

  describe("recoverSession()", () => {
    it("routes an explicitly continued unsent comparison through the original fanout checkpoint without submitting an ordinary prompt https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const runFanoutTurn = jest.fn(async (input: FanoutRunInput) => ({
        ...input.resumeTurn!,
        summary: { status: "done" as const, text: "Recovered comparison", complete: true },
      }));
      const subject = createHarness({ runFanoutTurn });
      const queued: FanoutTurn = {
        checkpoint: {
          fanoutId: "original-queued",
          mainModelKey: "a",
          prompt: [{ type: "text", text: "Original comparison" }],
          originalPromptText: "Original comparison",
          awaitingAdmission: true,
        },
        answers: {
          a: { backendId: "pi", modelKey: "a", status: "paused", text: "" },
          b: { backendId: "pi", modelKey: "b", status: "paused", text: "" },
        },
        summary: { status: "paused", text: "", complete: false },
      };
      const id = subject.session.store.addMessage({
        sender: AI_SENDER,
        message: "",
        timestamp: null,
        isVisible: true,
      });
      subject.session.store.setFanout(id, queued);
      subject.emit({
        sessionUpdate: "recovery_state",
        recovery: {
          status: "available",
          pendingPermissionIds: [],
          pendingQuestionIds: [],
          pendingMutationIds: [],
          crashLoopTripped: false,
        },
      });
      expect(runFanoutTurn).not.toHaveBeenCalled();
      await subject.session.recoverSession("continue");
      expect(subject.backend.recoverSession).not.toHaveBeenCalled();
      expect(runFanoutTurn).toHaveBeenCalledWith(
        expect.objectContaining({ fanoutId: "original-queued", resumeTurn: queued })
      );
      expect(subject.backend.prompt).not.toHaveBeenCalled();
    });

    it("allows a deliberate retry after the crash limit while preserving the backend's recovery decisions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, emit } = createHarness();
      emit({
        sessionUpdate: "recovery_state",
        recovery: {
          status: "read_only",
          crashLoopTripped: true,
          pendingPermissionIds: [],
          pendingQuestionIds: [],
          pendingMutationIds: [],
        },
      });

      await session.recoverSession("continue");

      expect(backend.recoverSession).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        action: "continue",
      });
      expect(session.getRecoveryState()?.status).toBe("read_only");
    });

    it("shows interrupted work without resuming until the user explicitly chooses continue or abort https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, emit } = createHarness();
      const recovery: RecoveryStateUpdate = {
        status: "available",
        pendingPermissionIds: [],
        pendingQuestionIds: [],
        pendingMutationIds: [],
        crashLoopTripped: false,
        message: "上次工作被打断。",
      };
      emit({ sessionUpdate: "recovery_state", recovery });

      expect(session.getRecoveryState()).toEqual(recovery);
      expect(backend.recoverSession).not.toHaveBeenCalled();
      expect(() => session.sendPrompt("新问题")).toThrow("继续");
      expect(session.store.getDisplayMessages()).toEqual([]);
      await session.recoverSession("continue");
      await session.recoverSession("abort");

      expect(backend.recoverSession).toHaveBeenNthCalledWith(1, {
        sessionId: SESSION_ID,
        action: "continue",
      });
      expect(backend.recoverSession).toHaveBeenNthCalledWith(2, {
        sessionId: SESSION_ID,
        action: "abort",
      });
      expect(backend.prompt).not.toHaveBeenCalled();
      emit({ sessionUpdate: "recovery_state", recovery: { ...recovery, status: "none" } });
      expect(session.getRecoveryState()?.status).toBe("none");
    });

    it("restores recovery from the display snapshot and refuses to continue an unreadable archive https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, emit } = createHarness();
      const recovery: RecoveryStateUpdate = {
        status: "read_only",
        pendingPermissionIds: [],
        pendingQuestionIds: [],
        pendingMutationIds: [],
        crashLoopTripped: false,
        message: "记录版本较新，请使用兼容版本查看，仍可导出。",
      };
      const update = projectionUpdate("archive", 1, "replace", []);
      if (update.sessionUpdate !== "session_projection") throw new Error("missing projection");
      update.projection.pending.recovery = recovery;
      emit(update);

      expect(session.getRecoveryState()).toEqual(recovery);
      await expect(session.recoverSession("continue")).rejects.toThrow("只读");
      expect(backend.recoverSession).not.toHaveBeenCalled();
    });
  });

  describe("setIsActive()", () => {
    it("keeps background updates subscribed while only the selected chat holds its backend open https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, emit } = createHarness();

      expect(backend.setSessionObserved).not.toHaveBeenCalled();
      session.setIsActive(true);
      session.setIsActive(true);
      session.setIsActive(false);
      emit(projectionUpdate("background", 1, "replace", [assistantMessage("reply", "saved")]));

      expect(backend.setSessionObserved).toHaveBeenNthCalledWith(1, {
        sessionId: SESSION_ID,
        observed: true,
      });
      expect(backend.setSessionObserved).toHaveBeenNthCalledWith(2, {
        sessionId: SESSION_ID,
        observed: false,
      });
      expect(backend.setSessionObserved).toHaveBeenCalledTimes(2);
      expect(session.store.getDisplayMessages()[0]?.message).toBe("saved");
      session.setIsActive(true);
      await session.dispose();
      expect(backend.setSessionObserved).toHaveBeenLastCalledWith({
        sessionId: SESSION_ID,
        observed: false,
      });
    });

    it("applies the latest selected-tab intent when the new backend session becomes ready https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let open: ((result: { sessionId: string; state: BackendState }) => void) | undefined;
      const backend = {
        newSession: () =>
          new Promise<{ sessionId: string; state: BackendState }>((resolve) => {
            open = resolve;
          }),
        registerSessionHandler: () => () => undefined,
        setSessionObserved: jest.fn(),
      } as unknown as BackendProcess;
      const session = AgentSession.start({
        backend,
        internalId: "starting-tab",
        backendId: "pi",
        cwd: "/vault",
      });
      session.setIsActive(true);
      session.setIsActive(false);
      expect(backend.setSessionObserved).not.toHaveBeenCalled();
      if (!open) throw new Error("newSession was not started");
      open({ sessionId: "new-root", state: { model: null, mode: null } });
      await session.ready;

      expect(backend.setSessionObserved).toHaveBeenCalledWith({
        sessionId: "new-root",
        observed: false,
      });
      session.setIsActive(true);
      expect(backend.setSessionObserved).toHaveBeenLastCalledWith({
        sessionId: "new-root",
        observed: true,
      });
      await session.dispose();
    });
  });

  describe("canSteer()", () => {
    it("offers supplemental input only for an active writable session whose backend supports it and whose recovery is clear https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, emit } = createHarness();
      expect(session.canSteer()).toBe(false);
      backend.steerSession = jest.fn(async () => undefined);
      expect(session.canSteer()).toBe(false);
      emit({
        sessionUpdate: "run_state",
        run: {
          runId: "work",
          requestId: "original",
          status: "running",
          startedAtMs: 1,
          cancelEpoch: 0,
        },
      });
      expect(session.canSteer()).toBe(true);
      emit({
        sessionUpdate: "recovery_state",
        recovery: {
          status: "available",
          pendingPermissionIds: [],
          pendingQuestionIds: [],
          pendingMutationIds: [],
          crashLoopTripped: false,
        },
      });
      expect(session.canSteer()).toBe(false);
      emit({
        sessionUpdate: "recovery_state",
        recovery: {
          status: "none",
          pendingPermissionIds: [],
          pendingQuestionIds: [],
          pendingMutationIds: [],
          crashLoopTripped: false,
        },
      });
      emit({ sessionUpdate: "state_changed", state: { model: null, mode: null, readOnly: true } });
      expect(session.canSteer()).toBe(false);
      await session.dispose();
    });
  });

  describe("steerPrompt()", () => {
    it("supplements the running turn through the backend without replacing it, and rejects idle or commands https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, completeTurn } = createHarness();
      backend.steerSession = jest.fn(async () => undefined);
      await expect(session.steerPrompt("尚未开始")).rejects.toThrow("补充");
      const sent = session.sendPrompt("原工作");

      expect(session.canSteer()).toBe(true);
      await session.steerPrompt("必须保留这条新要求");
      expect(backend.steerSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: SESSION_ID, text: "必须保留这条新要求" })
      );
      expect(backend.prompt).toHaveBeenCalledTimes(1);
      await expect(session.steerPrompt("/compact")).rejects.toThrow("文字");
      expect(backend.steerSession).toHaveBeenCalledTimes(1);
      completeTurn();
      await sent.turn;
      expect(session.canSteer()).toBe(false);
      await expect(session.steerPrompt("已结束")).rejects.toThrow("补充");
    });
    it("carries a queued message's attachments and note materials into the running turn https://github.com/ItsDalk-Lane/Vault-Agent/issues/16", async () => {
      const { session, backend, completeTurn } = createHarness();
      backend.steerSession = jest.fn(async () => undefined);
      const sent = session.sendPrompt("原工作");
      const note = { path: "Research.md" } as never;
      await session.steerPrompt("结合这段选区继续", { notes: [note], urls: [] }, [
        { type: "image", mimeType: "image/png", data: "AQID" },
      ]);
      expect(backend.steerSession).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "结合这段选区继续",
          prompt: [
            { type: "text", text: "结合这段选区继续" },
            { type: "image", mimeType: "image/png", data: "AQID" },
          ],
        })
      );
      const context = jest.mocked(backend.steerSession).mock.calls[0][0].context;
      expect(context?.materials).toEqual([
        { origin: "note", text: expect.stringContaining("Research.md"), sourcePath: "Research.md" },
      ]);
      completeTurn();
      await sent.turn;
    });
  });

  describe("sendPrompt()", () => {
    it("starts the next request when the cancelled SDK request settles without waiting for a quiet timer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      jest.useFakeTimers();
      const subject = createHarness();
      try {
        let finishPrevious!: (value: { stopReason: "end_turn" }) => void;
        const previous = new Promise<{ stopReason: "end_turn" }>((resolve) => {
          finishPrevious = resolve;
        });
        let nextStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          nextStarted = resolve;
        });
        jest
          .mocked(subject.backend.prompt)
          .mockImplementationOnce(() => previous)
          .mockImplementationOnce(async () => {
            nextStarted();
            return { stopReason: "end_turn", handledLocally: true };
          });
        const first = subject.session.sendPrompt("first request");
        await subject.session.cancel();
        expect(await first.turn).toBe("cancelled");
        const next = subject.session.sendPrompt("next request");
        expect(subject.backend.prompt).toHaveBeenCalledTimes(1);
        finishPrevious({ stopReason: "end_turn" });
        await started;
        expect(await next.turn).toBe("end_turn");
        expect(subject.backend.prompt).toHaveBeenCalledTimes(2);
      } finally {
        await subject.session.dispose();
        jest.useRealTimers();
      }
    });

    it("accepts a requirement only after a safely completed segment and still blocks unresolved recovery https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, emit } = createHarness();
      const recovery: RecoveryStateUpdate = {
        status: "available",
        continuationAvailable: true,
        pendingPermissionIds: [],
        pendingQuestionIds: [],
        pendingMutationIds: [],
        crashLoopTripped: false,
      };
      for (const unsafe of [
        { ...recovery, continuationAvailable: false },
        { ...recovery, status: "read_only" as const },
        { ...recovery, pendingMutationIds: ["unknown"] },
        { ...recovery, pendingPermissionIds: ["permission"] },
        { ...recovery, pendingQuestionIds: ["question"] },
        { ...recovery, crashLoopTripped: true },
      ]) {
        emit({ sessionUpdate: "recovery_state", recovery: unsafe });
        expect(() => session.sendPrompt("新要求")).toThrow("继续");
      }
      expect(backend.prompt).not.toHaveBeenCalled();
      expect(session.store.getDisplayMessages()).toEqual([]);
      emit({ sessionUpdate: "recovery_state", recovery });
      jest
        .mocked(backend.prompt)
        .mockResolvedValue({ stopReason: "end_turn", handledLocally: true });
      await expect(session.sendPrompt("保留原目标，补充这条要求").turn).resolves.toBe("end_turn");
      expect(backend.prompt).toHaveBeenCalledTimes(1);
      expect(session.store.getDisplayMessages()).toEqual([
        expect.objectContaining({ sender: USER_SENDER, message: "保留原目标，补充这条要求" }),
      ]);
      await session.dispose();
    });

    it("keeps a successful local command without inventing an empty model error https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend } = createHarness();
      const localResult = { stopReason: "end_turn" as const, handledLocally: true };
      jest.mocked(backend.prompt).mockResolvedValue(localResult);
      const sent = session.sendPrompt("/skill canonical:review");
      await expect(sent.turn).resolves.toBe("end_turn");
      expect(session.store.getDisplayMessages()).toEqual([
        expect.objectContaining({ sender: USER_SENDER, message: "/skill canonical:review" }),
      ]);
      expect(session.getStatus()).toBe("idle");
    });

    it("still reports an empty model response when no local command was handled https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend } = createHarness();
      jest.mocked(backend.prompt).mockResolvedValue({ stopReason: "end_turn" });
      await session.sendPrompt("answer this question").turn;
      expect(session.store.getDisplayMessages()).toEqual([
        expect.objectContaining({ sender: USER_SENDER, message: "answer this question" }),
        expect.objectContaining({ sender: AI_SENDER, isErrorMessage: true }),
      ]);
    });

    it("does not infer a second set of file changes when durable mutation receipts own the turn https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, emit, completeTurn } = createHarness();
      const { turn } = session.sendPrompt("change this note");
      emit({
        sessionUpdate: "tool_call",
        toolCallId: "write",
        title: "Write",
        kind: "edit",
        status: "in_progress",
        rawInput: { path: "a.md" },
      });
      emit({
        sessionUpdate: "tool_call_update",
        toolCallId: "write",
        status: "completed",
        originalFiles: { "a.md": "before" },
      });
      completeTurn();
      await turn;

      expect(
        session.store.getDisplayMessages().flatMap((message) => message.fileChanges ?? [])
      ).toEqual([]);
    });

    it("preserves labeled model answers after summary failure without looking up model ids as backends https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const backend = {
        registerSessionHandler: () => () => undefined,
        prompt: jest.fn(async () => ({ stopReason: "end_turn" })),
      } as unknown as BackendProcess;
      const getDisplayName = jest.fn((id: string) => {
        if (id !== "pi") throw new Error(`Unknown backend "${id}"`);
        return "Vault Agent";
      });
      const session = new AgentSession({
        backend,
        backendSessionId: "root",
        internalId: "fanout-summary-error",
        backendId: "pi",
        getDisplayName,
        runFanoutTurn: async () => ({
          answers: {
            "configured-a": {
              backendId: "pi",
              modelKey: "configured-a",
              label: "Model A",
              status: "done",
              text: "First independent answer",
            },
            "configured-b": {
              backendId: "pi",
              modelKey: "configured-b",
              label: "Model B",
              status: "done",
              text: "Second independent answer",
            },
          },
          summary: {
            status: "done",
            text: "",
            error: "Summary provider unavailable",
            complete: false,
          },
        }),
      });
      session.completeResume(null);
      await expect(
        session.sendPrompt("compare", undefined, undefined, ["configured-a", "configured-b"]).turn
      ).resolves.toBe("end_turn");
      const saved = session.store
        .getDisplayMessages()
        .find((message) => message.sender === AI_SENDER)!;
      expect(saved.message).toContain("First independent answer");
      expect(saved.fanout?.summary.error).toBe("Summary provider unavailable");
      expect(saved.isErrorMessage).not.toBe(true);
      expect(getDisplayName).not.toHaveBeenCalledWith("configured-a");
      await session.sendPrompt("continue from those answers").turn;
      expect(jest.mocked(backend.prompt).mock.calls[0][0]).toMatchObject({
        prompt: [{ type: "text", text: "continue from those answers" }],
        context: { materials: [] },
      });
    });
    it("passes large candidate material separately so every fanout model applies its own material budget https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const runFanoutTurn = jest.fn(async (input: FanoutRunInput) => ({
        answers: {
          a: { backendId: "pi", modelKey: "a", status: "done" as const, text: "a" },
          b: { backendId: "pi", modelKey: "b", status: "done" as const, text: "b" },
        },
        summary: { status: "done" as const, text: "summary", complete: true },
        checkpoint: {
          fanoutId: "fanout",
          mainModelKey: "a",
          prompt: input.prompt,
          context: input.context,
          originalPromptText: input.originalPromptText,
        },
      }));
      const session = new AgentSession({
        backend: { registerSessionHandler: () => () => undefined } as unknown as BackendProcess,
        backendSessionId: "root",
        internalId: "fanout",
        backendId: "pi",
        runFanoutTurn,
      });
      session.completeResume(null);
      const context = selectedTextContext();
      context.selectedTextContexts![0].content = "large-material-".repeat(20_000);

      await session.sendPrompt("question", context, undefined, ["a", "b"]).turn;

      const input = runFanoutTurn.mock.calls[0]?.[0];
      expect(JSON.stringify(input?.prompt)).not.toContain("large-material-");
      expect(input?.context?.materials[0]?.text).toContain("large-material-");
      expect(input?.originalPromptText).toBe("question");
    });
    it("separates the user's words from attached material when the backend owns durable history https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, completeTurn } = createHarness();
      const { turn } = session.sendPrompt("hello", selectedTextContext());
      expect(backend.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: [{ type: "text", text: "hello" }],
          context: expect.objectContaining({
            materials: [
              expect.objectContaining({
                origin: "note",
                text: expect.stringContaining("the selected note text"),
              }),
            ],
          }),
        })
      );
      completeTurn();
      await turn;
    });
    it("refuses a read-only session before creating a user message or contacting a provider https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { session, backend } = createHarness({ resume: false });
      session.completeResume({ model: null, mode: null, readOnly: true });
      expect(session.isHistoricalOnly()).toBe(true);
      expect(() => session.sendPrompt("继续执行")).toThrow("read-only");
      expect(session.store.getDisplayMessages()).toEqual([]);
      expect(backend.prompt).not.toHaveBeenCalled();
    });
  });
  describe("withReadOnlyPreamble()", () => {
    it("assigns only the candidate role without changing the original request or attachments https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const blocks = [
        { type: "text" as const, text: "Compare these notes in French" },
        { type: "image" as const, data: "fixture-image", mimeType: "image/png" },
      ];
      const result = withReadOnlyPreamble(blocks);
      const text = result[0] as { type: "text"; text: string };
      expect(text.text).toContain("one independent candidate");
      expect(text.text).toContain("host collects and synthesizes");
      expect(text.text).toContain("Do NOT modify any files");
      expect(text.text).toContain("do not coordinate or speculate about other candidates");
      expect(text.text.endsWith("Compare these notes in French")).toBe(true);
      expect(blocks[0].text).toBe("Compare these notes in French");
      expect(result[1]).toBe(blocks[1]);
    });
  });

  describe("buildPromptContext()", () => {
    it("preserves actual project text and source classes without manufacturing old history https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(
        buildPromptContext(selectedTextContext(), "web text", "project rules", "project update")
      ).toMatchObject({
        project: { text: "project rules\n\nproject update" },
        materials: [
          { origin: "note", text: expect.stringContaining("the selected note text") },
          { origin: "web", text: "web text" },
        ],
      });
      expect(buildPromptContext()).toEqual({ materials: [] });
      expect(buildPromptContext(undefined, undefined, undefined, "sources changed")).toEqual({
        materials: [],
        project: { text: "sources changed", updateOnly: true },
      });
    });
  });
  describe("dismissFeedbackOffer()", () => {
    it("persists dismissal through the backend and does not dismiss the same offer twice https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const harness = createHarness();
      harness.emit({ sessionUpdate: "feedback_offer", offer: persistedFeedback() });
      harness.session.dismissFeedbackOffer();
      harness.session.dismissFeedbackOffer();
      expect(harness.session.getFeedbackOffer()?.status).toBe("dismissed");
      expect(harness.backend.setFeedbackStatus).toHaveBeenCalledTimes(1);
      expect(harness.backend.setFeedbackStatus).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        offerId: "feedback-persisted",
        status: "dismissed",
      });
    });
  });
  describe("markFeedbackReported()", () => {
    it("persists the user-completed report and ignores a late report after dismissal https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const harness = createHarness();
      harness.emit({ sessionUpdate: "feedback_offer", offer: persistedFeedback() });
      const report = {
        reportId: "report-user-confirmed",
        issueUrl: "https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      };
      harness.session.markFeedbackReported(report);
      expect(harness.session.getFeedbackOffer()).toMatchObject({ status: "reported", report });
      expect(harness.backend.setFeedbackStatus).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        offerId: "feedback-persisted",
        status: "reported",
      });
      harness.emit({
        sessionUpdate: "feedback_offer",
        offer: { ...persistedFeedback(), status: "dismissed" },
      });
      harness.session.markFeedbackReported(report);
      expect(harness.session.getFeedbackOffer()?.status).toBe("dismissed");
      expect(harness.backend.setFeedbackStatus).toHaveBeenCalledTimes(1);
    });
  });
  describe("resumeFanout()", () => {
    it("does not acquire a writer or resume models from a read-only comparison snapshot https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const queued: FanoutTurn = {
        checkpoint: {
          fanoutId: "read-only-queued",
          mainModelKey: "a",
          prompt: [{ type: "text", text: "Saved comparison" }],
          originalPromptText: "Saved comparison",
          awaitingAdmission: true,
        },
        answers: {
          a: { backendId: "pi", modelKey: "a", status: "paused", text: "" },
          b: { backendId: "pi", modelKey: "b", status: "paused", text: "" },
        },
        summary: { status: "paused", text: "", complete: false },
      };
      const runFanoutTurn = jest.fn(async () => queued);
      const subject = createHarness({ runFanoutTurn });
      subject.session.completeResume({ model: null, mode: null, readOnly: true });
      const id = subject.session.store.addMessage({
        sender: AI_SENDER,
        message: "",
        timestamp: null,
        isVisible: true,
      });
      subject.session.store.setFanout(id, queued);
      await subject.session.resumeFanout(id);
      expect(runFanoutTurn).not.toHaveBeenCalled();
      expect(subject.backend.recoverSession).not.toHaveBeenCalled();
      expect(subject.backend.prompt).not.toHaveBeenCalled();
    });

    it("recovers the original paused SDK work before reading candidate results for synthesis https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const calls: string[] = [];
      const previous = {
        answers: {
          "cm-a": { backendId: "pi", modelKey: "cm-a", status: "paused" as const, text: "partial" },
        },
        summary: { status: "paused" as const, text: "", complete: false },
        checkpoint: {
          fanoutId: "paused",
          mainModelKey: "cm-a",
          originalPromptText: "Question",
          prompt: [{ type: "text" as const, text: "Question" }],
        },
      };
      const backend = {
        registerSessionHandler: () => () => undefined,
        recoverSession: jest.fn(async () => {
          calls.push("recover");
        }),
      } as unknown as BackendProcess;
      const session = new AgentSession({
        backend,
        backendSessionId: "root",
        internalId: "paused",
        backendId: "pi",
        runFanoutTurn: async () => {
          calls.push("read-candidates");
          return { ...previous, summary: { status: "done", text: "Recovered", complete: true } };
        },
      });
      session.completeResume(null);
      const id = session.store.addMessage({
        sender: AI_SENDER,
        message: "",
        timestamp: null,
        isVisible: true,
      });
      session.store.setFanout(id, previous);
      expect(calls).toEqual([]);
      await session.resumeFanout(id);
      expect(calls).toEqual(["recover", "read-candidates"]);
      expect(backend.recoverSession).toHaveBeenCalledWith({
        sessionId: "root",
        action: "continue",
      });
    });
    it("leaves recovered reports in durable history instead of reinjecting a UI copy into the next answer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const checkpoint = {
        fanoutId: "saved",
        mainModelKey: "cm-a",
        originalPromptText: "Compare alternatives",
        prompt: [{ type: "text" as const, text: "Compare alternatives" }],
      };
      const previous = {
        answers: {
          "cm-a": {
            backendId: "pi",
            modelKey: "cm-a",
            label: "Model A",
            status: "done" as const,
            text: "Answer A",
          },
          "cm-b": {
            backendId: "pi",
            modelKey: "cm-b",
            label: "Model B",
            status: "cancelled" as const,
            text: "",
          },
        },
        summary: { status: "done" as const, text: "", complete: false },
        checkpoint,
      };
      const backend = {
        registerSessionHandler: () => () => undefined,
        prompt: jest.fn(async () => ({ stopReason: "end_turn" })),
      } as unknown as BackendProcess;
      const session = new AgentSession({
        backend,
        backendSessionId: "root",
        internalId: "recovered-context",
        backendId: "pi",
        runFanoutTurn: async () => ({
          ...previous,
          summary: { status: "done", text: "Recovered synthesis", complete: true },
        }),
      });
      session.completeResume(null);
      const id = session.store.addMessage({
        sender: AI_SENDER,
        message: "",
        timestamp: null,
        isVisible: true,
      });
      session.store.setFanout(id, previous);
      await session.resumeFanout(id);
      await session.sendPrompt("Explain that conclusion").turn;
      expect(jest.mocked(backend.prompt).mock.calls[0][0]).toMatchObject({
        prompt: [{ type: "text", text: "Explain that conclusion" }],
        context: { materials: [] },
      });
      expect(session.store.getMessage(id)?.fanout?.summary.text).toBe("Recovered synthesis");
    });
    it("waits for an explicit continue and preserves the existing card while recovering https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const checkpoint = {
        fanoutId: "saved",
        mainModelKey: "cm-a",
        originalPromptText: "Question",
        prompt: [{ type: "text" as const, text: "Question" }],
      };
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const previous = {
        answers: {
          "cm-a": { backendId: "pi", modelKey: "cm-a", status: "done" as const, text: "Answer A" },
          "cm-b": { backendId: "pi", modelKey: "cm-b", status: "cancelled" as const, text: "" },
        },
        summary: { status: "done" as const, text: "", complete: false },
        checkpoint,
      };
      const runFanoutTurn = jest.fn(async () => {
        await pending;
        return {
          ...previous,
          summary: { status: "done" as const, text: "Recovered summary", complete: true },
        };
      });
      const session = new AgentSession({
        backend: { registerSessionHandler: () => () => undefined } as unknown as BackendProcess,
        backendSessionId: "root-main",
        internalId: "chat",
        backendId: "pi",
        runFanoutTurn,
      });
      session.completeResume(null);
      const id = session.store.addMessage({
        sender: AI_SENDER,
        message: "",
        isVisible: true,
        timestamp: null,
      });
      session.store.setFanout(id, previous);
      expect(runFanoutTurn).not.toHaveBeenCalled();
      const recovery = session.resumeFanout(id);
      expect(session.getStatus()).toBe("running");
      expect(runFanoutTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          fanoutId: "saved",
          resumeTurn: expect.objectContaining({ answers: previous.answers }),
          agents: ["cm-a", "cm-b"],
        })
      );
      finish();
      await recovery;
      expect(session.getStatus()).toBe("idle");
      expect(session.store.getDisplayMessages()).toHaveLength(1);
      expect(session.store.getMessage(id)?.fanout?.summary.text).toBe("Recovered summary");
      expect(session.store.getMessage(id)?.message).toContain("Recovered summary");
    });
  });
  describe("handleSessionEvent()", () => {
    it("preserves the optimistic question and original selection while older history is projected before the real user entry https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harness = createHarness();
      const previous = [
        userMessage("old-user", "older request"),
        assistantMessage("old-answer", "older answer"),
      ];
      harness.emit(projectionUpdate("epoch", 1, "replace", previous));
      const context = selectedTextContext();
      const { userMessageId, turn } = harness.session.sendPrompt("new request", context);
      harness.emit(projectionUpdate("epoch", 2, "replace", previous));
      expect(harness.session.store.getMessage(userMessageId)?.context).toBe(context);
      const next = [
        ...previous,
        userMessage("new-sdk-user", "new request"),
        assistantMessage("new-sdk-answer", "new answer"),
      ];
      harness.emit(projectionUpdate("epoch", 3, "replace", next));
      harness.emit(projectionUpdate("epoch", 4, "replace", next));
      harness.completeTurn();
      await turn;
      expect(harness.session.store.getDisplayMessages()).toHaveLength(4);
      expect(harness.session.store.getMessage(userMessageId)).toMatchObject({
        message: "new request",
      });
      expect(harness.session.store.getMessage(userMessageId)?.context).toBe(context);
      expect(harness.session.store.getDisplayMessages().map((message) => message.message)).toEqual([
        "older request",
        "older answer",
        "new request",
        "new answer",
      ]);
    });

    it("shows an explicitly recovered run as active and permits Stop without sending a new user turn https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { session, backend, emit } = createHarness();
      emit(runState({ status: "running" }));
      expect(session.getStatus()).toBe("running");
      await session.cancel();
      expect(backend.cancel).toHaveBeenCalledWith({ sessionId: SESSION_ID });
      emit(runState({ status: "cancelled", endedAtMs: 2_000 }));
      expect(session.getStatus()).toBe("idle");
      expect(backend.prompt).not.toHaveBeenCalled();
      expect(session.store.getDisplayMessages()).toEqual([]);
    });

    it("restores the actual feedback offer without manufacturing an assistant message https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const harness = createHarness();
      const offer = {
        id: "feedback-persisted",
        draft: {
          title: "Provider failed",
          whatHappened: "Repeated failure",
          userSaid: "",
          repro: "Retry the request",
        },
        evidence: {
          backendId: "pi",
          model: null,
          sessionId: SESSION_ID,
          raisedAt: "2026-10-22T00:00:00Z",
        },
        afterUserMessageId: null,
        status: "open" as const,
      };
      harness.emit({ sessionUpdate: "feedback_offer", offer });
      expect(harness.session.getFeedbackOffer()).toEqual(offer);
      expect(harness.session.store.getDisplayMessages()).toEqual([]);
      harness.emit({ sessionUpdate: "feedback_offer", offer: null });
      expect(harness.session.getFeedbackOffer()).toBeNull();
    });
    it("replaces the optimistic turn with the projection while keeping the user message id and context", async () => {
      const harness = createHarness();
      const context = selectedTextContext();
      const { userMessageId, turn } = harness.session.sendPrompt("hello", context);

      harness.emit(
        projectionUpdate("epoch-1", 1, "replace", [
          userMessage("pi-user-1", "hello"),
          assistantMessage("pi-assistant-1", "Hi there"),
        ])
      );

      const messages = harness.session.store.getDisplayMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        id: userMessageId,
        sender: USER_SENDER,
        message: "hello",
      });
      expect(messages[0]?.context).toBe(context);
      expect(messages[1]).toMatchObject({ sender: AI_SENDER, message: "Hi there" });

      harness.emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "!" } });
      expect(harness.session.store.getDisplayMessages()[1]?.message).toBe("Hi there!");

      harness.completeTurn();
      await turn;
    });

    it("settles the full answer once when an older recovered receipt is displayed after the current reply https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harness = createHarness();
      const receipt = Object.assign(
        assistantMessage("old-receipt", "", {
          parts: [],
          fileChanges: [
            {
              path: "a.md",
              status: "modified",
              before: "old",
              after: "restored",
              additions: 1,
              deletions: 1,
            },
          ],
        }),
        { isAuxiliary: true }
      );
      harness.emit(projectionUpdate("epoch", 1, "replace", [receipt]));
      const { turn } = harness.session.sendPrompt("continue");
      harness.emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "已" } });
      harness.emit(
        projectionUpdate("epoch", 2, "replace", [
          userMessage("actual-user", "continue"),
          assistantMessage("actual-answer", "已完整完成。"),
          receipt,
        ])
      );
      harness.completeTurn();
      await turn;
      const answers = harness.session.store
        .getDisplayMessages()
        .filter((message) => message.sender === AI_SENDER && message.message.length > 0);
      expect(answers.map((message) => message.message)).toEqual(["已完整完成。"]);
      expect(
        harness.session.store.getDisplayMessages().find((message) => message.id === "old-receipt")
          ?.fileChanges
      ).toEqual(receipt.fileChanges);
      expect(
        harness.session.store.getDisplayMessages().find((message) => message.id === "old-receipt")
          ?.isAuxiliary
      ).toBe(true);
    });

    it("does not notify, duplicate or rebuild the window when the same snapshot repeats", () => {
      const harness = createHarness();
      const changed = jest.fn();
      harness.session.subscribe({ onMessagesChanged: changed, onStatusChanged: () => undefined });
      const snapshot = projectionUpdate("epoch-1", 1, "replace", [
        userMessage("pi-user-1", "hello"),
        assistantMessage("pi-assistant-1", "Hi there"),
      ]);

      harness.emit(snapshot);
      const display = harness.session.store.getDisplayMessages();
      expect(changed).toHaveBeenCalledTimes(1);

      harness.emit(snapshot);
      harness.emit(
        projectionUpdate("epoch-2", 1, "replace", [
          userMessage("pi-user-1", "hello"),
          assistantMessage("pi-assistant-1", "Hi there"),
        ])
      );

      expect(changed).toHaveBeenCalledTimes(1);
      expect(harness.session.store.getDisplayMessages()).toBe(display);
      expect(messageIds(harness.session)).toEqual(["pi-user-1", "pi-assistant-1"]);
    });

    it("drops a frame whose cursor is older than the accepted frame in the same epoch", () => {
      const harness = createHarness();
      harness.emit(
        projectionUpdate("epoch-1", 2, "replace", [assistantMessage("pi-assistant-new", "newer")])
      );
      const display = harness.session.store.getDisplayMessages();

      harness.emit(
        projectionUpdate("epoch-1", 1, "replace", [assistantMessage("pi-assistant-old", "older")])
      );

      expect(harness.session.store.getDisplayMessages()).toBe(display);
      expect(messageIds(harness.session)).toEqual(["pi-assistant-new"]);
    });

    it("prepends paged history in front of the loaded window without duplicates", () => {
      const harness = createHarness();
      harness.emit(projectionUpdate("epoch-1", 1, "replace", [assistantMessage("a2", "current")]));

      harness.emit(
        projectionUpdate("epoch-1", 2, "prepend", [
          userMessage("u1", "older question"),
          assistantMessage("a1", "older answer"),
        ])
      );

      expect(messageIds(harness.session)).toEqual(["u1", "a1", "a2"]);

      const display = harness.session.store.getDisplayMessages();
      harness.emit(
        projectionUpdate("epoch-1", 3, "prepend", [
          userMessage("u1", "older question"),
          assistantMessage("a1", "older answer"),
        ])
      );
      expect(harness.session.store.getDisplayMessages()).toBe(display);
    });

    it("keeps the restored order and stable ids when the same history is projected again", () => {
      const harness = createHarness();
      const history = [
        userMessage("pi-user-1", "question one"),
        assistantMessage("pi-assistant-1", "answer one"),
        userMessage("pi-user-2", "question two"),
        assistantMessage("pi-assistant-2", "answer two"),
      ];

      harness.emit(projectionUpdate("epoch-1", 1, "replace", history));
      const before = messageIds(harness.session);
      harness.emit(
        projectionUpdate(
          "epoch-2",
          1,
          "replace",
          history.map((message) => ({ ...message }))
        )
      );

      expect(messageIds(harness.session)).toEqual(before);
      expect(
        harness.session.store
          .getDisplayMessages()
          .map((message) => [message.sender, message.message])
      ).toEqual([
        [USER_SENDER, "question one"],
        [AI_SENDER, "answer one"],
        [USER_SENDER, "question two"],
        [AI_SENDER, "answer two"],
      ]);
    });

    it("keeps the incremental replay path for backends that never send a projection", () => {
      const harness = createHarness({ resume: false });

      harness.emit({
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "replayed question" },
      });
      harness.emit({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "replayed answer" },
      });
      harness.session.completeResume(null);

      expect(
        harness.session.store
          .getDisplayMessages()
          .map((message) => [message.sender, message.message])
      ).toEqual([
        [USER_SENDER, "replayed question"],
        [AI_SENDER, "replayed answer"],
      ]);
    });

    it("keeps completed file changes when a cancelled run reports its persisted timing", async () => {
      const harness = createHarness();
      const { turn } = harness.session.sendPrompt("hello");
      const assistantId = harness.session.store.getDisplayMessages()[1]?.id;
      if (assistantId === undefined) throw new Error("the turn placeholder is missing");
      const changes: TurnFileChange[] = [
        {
          path: "notes/plan.md",
          status: "modified",
          before: "old",
          after: "new",
          additions: 1,
          deletions: 1,
        },
      ];
      harness.session.store.setFileChanges(assistantId, changes);

      harness.emit(runState({ status: "running", startedAtMs: 1_000 }));
      harness.emit(
        runState({
          status: "cancelled",
          startedAtMs: 1_000,
          endedAtMs: 5_000,
          stopCode: "CANCELLED",
          cancelEpoch: 1,
        })
      );

      expect(harness.session.getRunState()?.status).toBe("cancelled");
      expect(harness.session.store.getMessage(assistantId)?.fileChanges).toEqual(changes);
      expect(harness.session.store.getDisplayMessages()).toHaveLength(2);

      harness.completeTurn();
      await turn;
    });

    it("takes the completed turn duration from the persisted run timing", async () => {
      const harness = createHarness();
      const { turn } = harness.session.sendPrompt("hello");
      const assistantId = harness.session.store.getDisplayMessages()[1]?.id;
      if (assistantId === undefined) throw new Error("the turn placeholder is missing");
      harness.emit(runState({ status: "running", startedAtMs: 1_000 }));
      harness.emit(
        runState({ status: "completed", startedAtMs: 1_000, endedAtMs: 5_000, cancelEpoch: 0 })
      );

      harness.completeTurn();
      await turn;

      expect(harness.session.store.getMessage(assistantId)?.turnDurationMs).toBe(4_000);
    });

    it("keeps known usage when a provider budget reports unknown usage", () => {
      const harness = createHarness();

      harness.emit({
        sessionUpdate: "usage_update",
        usage: { usedTokens: 1_234, contextWindow: 100_000, updatedAt: 1 },
      });
      harness.emit(budgetUpdate({ source: "unknown", usage: null, updatedAt: 2 }));

      expect(harness.session.getSessionUsage()).toMatchObject({
        usedTokens: 1_234,
        contextWindow: 100_000,
      });
      expect(harness.session.getBudget()).toMatchObject({ source: "unknown", usage: null });

      harness.emit(
        budgetUpdate({ source: "local_budget", usage: { usedTokens: 0, updatedAt: 3 } })
      );
      expect(harness.session.getSessionUsage()?.usedTokens).toBe(1_234);
    });
    it("projects todo_update into the current todo list and the plan part", async () => {
      const harness = createHarness();
      const { turn } = harness.session.sendPrompt("hello");
      harness.emit(runState({ status: "running", startedAtMs: 1_000 }));

      harness.emit({
        sessionUpdate: "todo_update",
        todo: {
          revision: 2,
          items: [
            { id: "a", text: "read the plan", status: "completed", priority: "high" },
            { id: "b", text: "write the code", status: "in_progress", priority: "medium" },
          ],
        },
      });

      expect(harness.session.getCurrentTodoList()).toEqual([
        { content: "read the plan", status: "completed" },
        { content: "write the code", status: "in_progress" },
      ]);
      const planParts = harness.session.store
        .getDisplayMessages()
        .flatMap((message) => message.parts ?? [])
        .filter((part) => part.kind === "plan");
      expect(planParts).toHaveLength(1);
      expect(planParts[0]).toMatchObject({
        kind: "plan",
        entries: [
          { content: "read the plan", priority: "high", status: "completed" },
          { content: "write the code", priority: "medium", status: "in_progress" },
        ],
      });

      harness.emit(runState({ status: "completed", startedAtMs: 1_000, endedAtMs: 2_000 }));
      harness.completeTurn();
      await turn;
    });
    it("applies a newer plan proposal and ignores a stale replay", async () => {
      const harness = createHarness();
      const { turn } = harness.session.sendPrompt("hello");
      harness.emit(runState({ status: "running", startedAtMs: 1_000 }));

      const plan = (revision: number, body: string) => ({
        sessionUpdate: "plan_proposal_update" as const,
        plan: {
          id: "plan-1",
          revision,
          title: "Ship it",
          body,
          permissionGated: revision === 1,
          pendingToolCallId: "tool-call-1",
          decision: "pending" as const,
        },
      });
      harness.emit(plan(2, "latest body"));
      expect(harness.session.getCurrentPlan()).toMatchObject({ body: "latest body", revision: 2 });

      harness.emit(plan(1, "older body"));
      expect(harness.session.getCurrentPlan()).toMatchObject({ body: "latest body", revision: 2 });

      harness.emit(plan(3, "newest body"));
      expect(harness.session.getCurrentPlan()).toMatchObject({ body: "newest body", revision: 3 });

      harness.emit(runState({ status: "completed", startedAtMs: 1_000, endedAtMs: 2_000 }));
      harness.completeTurn();
      await turn;
    });
  });
});
