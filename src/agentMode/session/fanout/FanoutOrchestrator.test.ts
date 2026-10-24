import {
  FanoutOrchestrator,
  createFanoutTurn,
  type FanoutHost,
  type FanoutRunInput,
} from "./FanoutOrchestrator";
import { parseFanoutComposite, serializeFanoutComposite, type FanoutTurn } from "./fanoutTypes";
import type { BackendProcess, PromptInput, SessionUpdateHandler } from "@/agentMode/session/types";
import { byteLength } from "@/utils/logTail";
import { sha256 } from "@/utils/hash";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function harness(
  options: {
    pause?: readonly string[];
    fail?: readonly string[];
    empty?: readonly string[];
    budgetPause?: readonly string[];
    hold?: readonly string[];
    cancelled?: readonly string[];
  } = {}
) {
  const handlers = new Map<string, SessionUpdateHandler>();
  const models = new Map<string, string>();
  const readers = new Set<string>();
  const requests: Array<{ sessionId: string; modelKey: string; requestId?: string }> = [];
  const engines: string[] = [];
  const pending = new Map<string, (stopReason: string) => void>();
  let signalSummaryStarted!: () => void;
  const summaryStarted = new Promise<void>((resolve) => {
    signalSummaryStarted = resolve;
  });
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const state = { model: null, mode: null };
  const persisted: FanoutTurn[] = [];
  const proc = {
    recordFanoutTurn: jest.fn(async ({ turn }: { turn: FanoutTurn }) => {
      persisted.push(turn);
    }),
    newSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({ sessionId, state })),
    registerSessionHandler: (id: string, handler: SessionUpdateHandler) => {
      handlers.set(id, handler);
      return () => handlers.delete(id);
    },
    setSessionMode: jest.fn(
      async ({ sessionId, modeId }: { sessionId: string; modeId: string }) => {
        expect(modeId).toBe("plan");
        expect(readers.has(sessionId)).toBe(true);
        return state;
      }
    ),
    setSessionModel: jest.fn(
      async ({ sessionId, modelId }: { sessionId: string; modelId: string }) => {
        models.set(sessionId, modelId);
        return state;
      }
    ),
    prompt: jest.fn(async (input: PromptInput) => {
      const modelKey = models.get(input.sessionId)!;
      requests.push({ sessionId: input.sessionId, modelKey, requestId: input.requestId });
      expect(readers.has(input.sessionId)).toBe(true);
      if (requests.length === 2) signalStarted();
      const slot = input.requestId?.endsWith(":summary") ? "summary" : modelKey;
      if (slot === "summary") signalSummaryStarted();
      if (options.fail?.includes(modelKey)) throw new Error("Provider unavailable");
      const text = options.empty?.includes(modelKey)
        ? ""
        : input.requestId?.endsWith(":summary")
          ? "Combined answer"
          : `Answer from ${modelKey}`;
      handlers.get(input.sessionId)?.({
        sessionId: input.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
      });
      if (options.budgetPause?.includes(modelKey)) return { stopReason: "max_turn_requests" };
      if (options.cancelled?.includes(modelKey)) return { stopReason: "cancelled" };
      if (options.pause?.includes(modelKey) || options.hold?.includes(slot)) {
        const stopReason = await new Promise<string>((resolve) =>
          pending.set(input.sessionId, resolve)
        );
        return { stopReason };
      }
      return { stopReason: "end_turn" };
    }),
    cancel: jest.fn(async ({ sessionId }: { sessionId: string }) => {
      expect(readers.has(sessionId)).toBe(true);
      pending.get(sessionId)?.("cancelled");
    }),
    closeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
      expect(readers.has(sessionId)).toBe(true);
    }),
  } as unknown as BackendProcess;
  const host: FanoutHost = {
    ensureBackendForFanout: async (backendId) => {
      engines.push(backendId);
      return { proc, descriptor: {} as never };
    },
    getDefaultSelection: () => ({ baseModelId: "cm-a", effort: null }),
    getFanoutModels: () =>
      ["cm-a", "cm-b"].map((modelKey) => ({
        modelKey,
        label: modelKey === "cm-a" ? "Claude" : "GPT",
        engineId: "pi",
        hasKey: true,
      })),
    getDisplayName: (key) => key,
    getCwd: () => "/vault",
    registerReadOnlySession: (id) => {
      readers.add(id);
      return () => {
        readers.delete(id);
      };
    },
    excludeSubSessionFromHistory: jest.fn(),
  };
  return {
    host,
    proc,
    requests,
    persisted,
    engines,
    readers,
    started,
    summaryStarted,
    finish: (modelKey: string) => {
      const request = requests.find((item) =>
        modelKey === "summary" ? item.requestId?.endsWith(":summary") : item.modelKey === modelKey
      );
      if (!request) throw new Error(`Missing pending model ${modelKey}`);
      pending.get(request.sessionId)?.("end_turn");
    },
    orchestrator: new FanoutOrchestrator(host),
  };
}

function input(overrides: Partial<FanoutRunInput> = {}): FanoutRunInput {
  return {
    agents: ["cm-a", "cm-b"],
    mainAgent: "pi",
    fanoutId: "turn-1",
    prompt: [{ type: "text", text: "Compare these notes" }],
    originalPromptText: "Compare these notes",
    signal: new AbortController().signal,
    onChange: () => undefined,
    ...overrides,
  };
}

describe("FanoutOrchestrator", () => {
  describe("createFanoutTurn()", () => {
    it("seeds independent model slots on the single Pi engine", () => {
      expect(createFanoutTurn(["cm-a", "cm-b"])).toEqual({
        answers: {
          "cm-a": { backendId: "pi", modelKey: "cm-a", status: "running", text: "" },
          "cm-b": { backendId: "pi", modelKey: "cm-b", status: "running", text: "" },
        },
        summary: { status: "pending", text: "" },
      });
    });
  });

  describe("FanoutOrchestrator", () => {
    describe("run()", () => {
      it("returns an unstarted paused card when its capacity waiter is withdrawn without creating candidates https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness();
        run.proc.recordFanoutTurn = jest.fn(async () => {
          throw Object.assign(new Error("queued pause"), { code: "QUEUED_INPUT_PAUSED" });
        });
        const turn = await run.orchestrator.run(input({ parentSessionId: "queued-root" }));
        expect(turn).toMatchObject({
          checkpoint: { fanoutId: "turn-1", awaitingAdmission: true },
          summary: { status: "paused", complete: false },
          answers: { "cm-a": { status: "paused" }, "cm-b": { status: "paused" } },
        });
        expect(run.requests).toEqual([]);
        expect(run.proc.newSession).not.toHaveBeenCalled();
        expect(run.proc.recordFanoutTurn).toHaveBeenCalledTimes(1);
      });
      it.each(["CANCELLED", "signal-aborted"])(
        "returns cancelled without creating candidates when queued input is stopped through %s https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        async (code) => {
          const run = harness();
          const controller = new AbortController();
          if (code === "signal-aborted") controller.abort();
          run.proc.recordFanoutTurn = jest.fn(async () => {
            throw Object.assign(new Error("queued stopped"), { code });
          });
          const turn = await run.orchestrator.run(
            input({ parentSessionId: "queued-root", signal: controller.signal })
          );
          expect(Object.values(turn.answers).every((answer) => answer.status === "cancelled")).toBe(
            true
          );
          expect(turn.summary).toMatchObject({ status: "done", complete: false });
          expect(run.proc.newSession).not.toHaveBeenCalled();
        }
      );
      it("preserves an actual checkpoint-save failure instead of starting unrecorded candidates https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness();
        run.proc.recordFanoutTurn = jest.fn(async () => {
          throw new Error("durable save failed");
        });
        await expect(
          run.orchestrator.run(input({ parentSessionId: "queued-root" }))
        ).rejects.toThrow("durable save failed");
        expect(run.proc.newSession).not.toHaveBeenCalled();
      });
      it("saves the recovery checkpoint before dispatch and retains independent terminal snapshots in the parent https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness();
        const result = await run.orchestrator.run(input({ parentSessionId: "root-parent" }));
        expect(run.proc.recordFanoutTurn).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: "root-parent" })
        );
        expect(run.persisted[0].answers["cm-a"]).toMatchObject({ status: "running", text: "" });
        expect(run.persisted[0].summary.status).toBe("pending");
        expect(run.persisted.at(-1)).toEqual(result);
        expect(run.persisted.filter((turn) => turn.summary.complete)).toHaveLength(1);
      });
      it("refuses to start paid model requests when the parent recovery checkpoint cannot be saved https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness();
        jest
          .mocked(run.proc.recordFanoutTurn!)
          .mockRejectedValue(new Error("checkpoint storage unavailable"));
        await expect(
          run.orchestrator.run(input({ parentSessionId: "root-parent" }))
        ).rejects.toThrow("checkpoint storage unavailable");
        expect(run.requests).toEqual([]);
      });

      it("runs saved models through independent read-only Pi sessions and one summary https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness();
        const result = await run.orchestrator.run(input());
        expect(run.engines).toEqual(["pi", "pi", "pi"]);
        expect(result.answers["cm-a"]).toMatchObject({
          modelKey: "cm-a",
          label: "Claude",
          text: "Answer from cm-a",
          status: "done",
        });
        expect(result.answers["cm-b"]).toMatchObject({
          modelKey: "cm-b",
          label: "GPT",
          text: "Answer from cm-b",
          status: "done",
        });
        expect(new Set(run.requests.map((request) => request.sessionId)).size).toBe(3);
        expect(
          run.requests.every((request) => /^root-fanout-[a-f0-9]{64}$/.test(request.sessionId))
        ).toBe(true);
        expect(run.requests.map((request) => request.requestId)).toEqual([
          "fanout:turn-1:cm-a",
          "fanout:turn-1:cm-b",
          "fanout:turn-1:summary",
        ]);
        expect(result.summary).toMatchObject({ text: "Combined answer", complete: true });
        expect(run.proc.closeSession).toHaveBeenCalledTimes(3);
        expect(run.readers.size).toBe(0);
      });

      it("keeps the original SDK candidate paused at a budget limit and does not synthesize a partial success https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness({ budgetPause: ["cm-b"] });
        const result = await run.orchestrator.run(input({ parentSessionId: "root-parent" }));
        expect(result.answers["cm-b"]).toMatchObject({
          status: "paused",
          text: "Answer from cm-b",
        });
        expect(result.summary).toMatchObject({ status: "paused", complete: false });
        expect(run.requests).toHaveLength(2);
        expect(run.proc.closeSession).toHaveBeenCalledTimes(1);
        expect(run.proc.cancel).not.toHaveBeenCalled();
        expect(run.persisted.at(-1)).toEqual(result);
        const restored = parseFanoutComposite(serializeFanoutComposite(result, (key) => key));
        expect(restored?.answers["cm-b"].status).toBe("paused");
        expect(restored?.summary.status).toBe("paused");
      });

      it.each(["candidate", "summary"])(
        "keeps a slow %s alive beyond five minutes until its real task finishes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        async (phase) => {
          jest.useFakeTimers();
          const held = phase === "candidate" ? "cm-b" : "summary";
          const run = harness({ hold: [held] });
          const controller = new AbortController();
          const pending = run.orchestrator.run(input({ signal: controller.signal }));
          try {
            await (phase === "candidate" ? run.started : run.summaryStarted);
            await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
            expect(run.proc.cancel).not.toHaveBeenCalled();
            expect(run.readers.size).toBeGreaterThan(0);
            run.finish(held);
            const result = await pending;
            expect(Object.values(result.answers).every((answer) => answer.status === "done")).toBe(
              true
            );
            expect(result.summary).toMatchObject({ complete: true, text: "Combined answer" });
            expect(run.readers.size).toBe(0);
          } finally {
            controller.abort();
            await pending;
            jest.useRealTimers();
          }
        }
      );

      it("still cancels an active summary through the same explicit Stop without marking it complete https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness({ hold: ["summary"] });
        const controller = new AbortController();
        const pending = run.orchestrator.run(input({ signal: controller.signal }));
        await run.summaryStarted;
        controller.abort();
        const result = await pending;
        expect(Object.values(result.answers).every((answer) => answer.status === "done")).toBe(
          true
        );
        expect(result.summary.complete).toBe(false);
        expect(run.proc.cancel).toHaveBeenCalledTimes(1);
        expect(run.proc.closeSession).toHaveBeenCalledTimes(3);
        expect(run.readers.size).toBe(0);
      });

      it("passes cancellation and its partial report as untrusted non-success data to the summary https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness({ cancelled: ["cm-b"] });
        const result = await run.orchestrator.run(input());
        expect(result.answers["cm-b"]).toMatchObject({
          status: "cancelled",
          text: "Answer from cm-b",
        });
        expect(result.answers["cm-b"].error).toBeUndefined();
        const summary = jest.mocked(run.proc.prompt).mock.calls[2][0];
        expect(JSON.stringify(summary.prompt)).not.toContain("Answer from cm-a");
        expect(JSON.stringify(summary.prompt)).not.toContain("Answer from cm-b");
        const reports = summary
          .context!.materials.slice(1)
          .map((material) => JSON.parse(material.text));
        expect(reports[0]).toMatchObject({
          status: "done",
          usableAsCompletedAnswer: true,
          completion: { stopReason: "end_turn" },
        });
        expect(reports[1]).toMatchObject({
          status: "cancelled",
          text: "Answer from cm-b",
          usableAsCompletedAnswer: false,
        });
        expect(result.summary.complete).toBe(true);
      });

      it("preserves a successful candidate when another provider fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness({ fail: ["cm-b"] });
        const result = await run.orchestrator.run(input());
        expect(result.answers["cm-a"].status).toBe("done");
        expect(result.answers["cm-b"]).toMatchObject({
          status: "error",
          error: "Provider unavailable",
        });
        expect(result.summary.complete).toBe(true);
      });

      it("bounds recovery context without truncating the actual candidate materials https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness();
        const oversized = "资料".repeat(50_000);
        const context = {
          project: { text: "项目要求", sourcePath: "project.md" },
          materials: [
            { origin: "note" as const, text: "完整小材料", sourcePath: "small.md" },
            { origin: "note" as const, text: oversized, sourcePath: "large.md" },
          ],
        };
        const result = await run.orchestrator.run(input({ context }));
        expect(run.proc.prompt).toHaveBeenNthCalledWith(1, expect.objectContaining({ context }));
        expect(run.proc.prompt).toHaveBeenNthCalledWith(2, expect.objectContaining({ context }));
        expect(byteLength(JSON.stringify(result.checkpoint!.context))).toBeLessThanOrEqual(
          128 * 1024
        );
        expect(result.checkpoint!.context!.project).toEqual(context.project);
        expect(result.checkpoint!.context!.materials[0]).toEqual(context.materials[0]);
        expect(JSON.stringify(result.checkpoint!.context)).not.toContain(oversized);
        expect(JSON.stringify(result.checkpoint!.context)).toContain(sha256(oversized));
        expect(JSON.stringify(result.checkpoint!.context)).toContain("300000");
        expect(JSON.stringify(result.checkpoint!.context)).toContain("large.md");
        const restored = parseFanoutComposite(serializeFanoutComposite(result, (key) => key))!;
        expect(restored.checkpoint!.context).toEqual(result.checkpoint!.context);
      });

      it("bounds recovery metadata and omission receipts when many materials exceed the limit https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness();
        const result = await run.orchestrator.run(
          input({
            context: {
              project: { text: "项目要求".repeat(30_000), sourcePath: "project.md" },
              materials: Array.from({ length: 500 }, (_, index) => ({
                origin: "web" as const,
                text: "正文".repeat(30_000),
                url: `https://example.com/${index}/${"x".repeat(4096)}`,
              })),
            },
          })
        );
        const saved = JSON.stringify(result.checkpoint!.context);
        expect(byteLength(saved)).toBeLessThanOrEqual(128 * 1024);
        expect(saved).toContain("省略");
        expect(saved).not.toContain("项目要求".repeat(30_000));
      });

      it("cancels every active child before releasing its read-only guard https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness({ pause: ["cm-a", "cm-b"] });
        const controller = new AbortController();
        const pending = run.orchestrator.run(input({ signal: controller.signal }));
        await run.started;
        controller.abort();
        const result = await pending;
        expect(Object.values(result.answers).map((answer) => answer.status)).toEqual([
          "cancelled",
          "cancelled",
        ]);
        expect(run.proc.cancel).toHaveBeenCalledTimes(2);
        expect(run.proc.closeSession).toHaveBeenCalledTimes(2);
        expect(run.requests).toHaveLength(2);
        expect(run.readers.size).toBe(0);
      });

      it("reopens a saved turn without rerunning its completed model https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const interrupted = harness({ pause: ["cm-b"] });
        const controller = new AbortController();
        const pending = interrupted.orchestrator.run(input({ signal: controller.signal }));
        await interrupted.started;
        controller.abort();
        const saved = await pending;
        expect(saved.answers["cm-a"].status).toBe("done");
        const restored = parseFanoutComposite(serializeFanoutComposite(saved, (key) => key))!;
        expect(restored.checkpoint).toEqual(saved.checkpoint);
        const reopened = harness();
        expect(reopened.requests).toHaveLength(0);
        const result = await reopened.orchestrator.run(
          input({ resumeTurn: restored, fanoutId: restored.checkpoint!.fanoutId })
        );
        expect(reopened.requests.map((request) => request.requestId)).toEqual([
          "fanout:turn-1:cm-b",
          "fanout:turn-1:summary",
        ]);
        expect(reopened.requests[0].sessionId).toBe(interrupted.requests[1].sessionId);
        expect(result.answers["cm-a"]).toEqual(restored.answers["cm-a"]);
        expect(result.summary.complete).toBe(true);
        const complete = parseFanoutComposite(serializeFanoutComposite(result, (key) => key))!;
        const finished = harness();
        await finished.orchestrator.run(input({ resumeTurn: complete }));
        expect(finished.requests).toHaveLength(0);
      });

      it("rejects a missing model before opening any child https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness();
        await expect(
          run.orchestrator.run(input({ agents: ["cm-a", "missing"] }))
        ).rejects.toMatchObject({ code: "FANOUT_MODEL_UNAVAILABLE" });
        expect(run.engines).toHaveLength(0);
      });

      it("reports empty model output as an error instead of a completed answer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const run = harness({ empty: ["cm-a", "cm-b"] });
        const result = await run.orchestrator.run(input());
        expect(Object.values(result.answers).map((answer) => answer.status)).toEqual([
          "error",
          "error",
        ]);
        expect(run.requests).toHaveLength(2);
      });
    });
  });
});
