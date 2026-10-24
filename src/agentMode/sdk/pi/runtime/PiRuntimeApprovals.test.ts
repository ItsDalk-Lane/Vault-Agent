import type { Conversation, Harness } from "@earendil-works/pi-durable";
import type {
  PermissionPrompt,
  PermissionDecision,
  BackendProcess,
  SessionUpdateHandler,
} from "@/agentMode/session/types";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { createPiRuntimeApprovals } from "./PiRuntimeApprovals";

jest.mock(
  "@earendil-works/pi-durable",
  () => ({ defineDoc: (definition: unknown) => ({ definition }) }),
  { virtual: true }
);
jest.mock("@earendil-works/chord/context", () => ({ BACKGROUND_CONTEXT: {} }), { virtual: true });
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn(() => ({ agentMode: {} })) }));

const prompt: PermissionPrompt = {
  sessionId: "root",
  toolCall: {
    toolCallId: "original-call",
    title: "vault_edit",
    kind: "edit",
    rawInput: { path: "a.md" },
    content: [{ type: "diff", path: "a.md", oldText: "before", newText: "after" }],
  },
  options: [
    { optionId: "yes", name: "允许这一次", kind: "allow_once" },
    { optionId: "no", name: "拒绝", kind: "reject_once" },
  ],
  binding: {
    toolId: "vault_edit",
    schemaHash: "schema",
    targets: ["a.md"],
    beforeHash: "before-hash",
    scopeVersion: 1,
    policyVersion: 1,
  },
};

function fixture() {
  let document: unknown;
  let policy = "initial";
  let valid = true;
  let failure = false;
  const entries: unknown[] = [];
  const harness = { snapshot: jest.fn(async () => document) };
  const conversation = {
    id: 1,
    commit: jest.fn(async (work) => {
      const next = document
        ? JSON.parse(JSON.stringify(document))
        : { revision: 0, approvals: { decisions: {}, requests: {} }, records: {} };
      const added: unknown[] = [];
      await work({
        doc: async () => next,
        appendEntry: async (_id: unknown, entry: unknown) => {
          added.push(entry);
        },
      });
      if (failure) throw new Error("disk unavailable");
      document = next;
      entries.push(...added);
    }),
  };
  const emit = jest.fn();
  const open = (
    show: (prompt: PermissionPrompt) => Promise<PermissionDecision> = jest.fn(
      () => new Promise<never>(() => undefined)
    )
  ) =>
    createPiRuntimeApprovals({
      harness: harness as unknown as Harness,
      conversation: conversation as unknown as Conversation,
      sessionId: "root",
      scopeId: "scope",
      getPolicyKey: () => policy,
      validate: async () => valid,
      show,
      emit,
    });
  return {
    open,
    entries,
    emit,
    get document() {
      return document;
    },
    set policy(value: string) {
      policy = value;
    },
    set valid(value: boolean) {
      valid = value;
    },
    set failure(value: boolean) {
      failure = value;
    },
  };
}

describe("PiRuntimeApprovals", () => {
  describe("createPiRuntimeApprovals()", () => {
    it.each(["consumed_allow", "rejected"] as const)(
      "preserves the settled %s decision after time, policy and file facts change during recovery https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (kind) => {
        const clock = jest.spyOn(Date, "now").mockReturnValue(100);
        try {
          const subject = fixture();
          const show = jest.fn(
            async (): Promise<PermissionDecision> => ({
              outcome: { outcome: "selected", optionId: kind === "consumed_allow" ? "yes" : "no" },
            })
          );
          const host = await subject.open(show);
          await host.request(prompt);
          const committed = JSON.stringify(subject.document);
          const entries = subject.entries.length;
          subject.valid = false;
          subject.policy = "changed-after-decision";
          clock.mockReturnValue(700000);
          await host.prepareRecovery();
          expect(JSON.stringify(subject.document)).toBe(committed);
          expect(subject.entries).toHaveLength(entries);
          expect(host.pending).toEqual([]);
          expect(host.recoveryApprovals()).toEqual([]);
          host.dispose();
          const reopened = await subject.open(show);
          await reopened.prepareRecovery();
          expect(JSON.stringify(subject.document)).toBe(committed);
          expect(subject.entries).toHaveLength(entries);
          expect(show).toHaveBeenCalledTimes(1);
          reopened.dispose();
        } finally {
          clock.mockRestore();
        }
      }
    );

    it.each([false, true])(
      "preserves pending approval on owner suspension and withdraws only the temporary window (plan=%s) https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (isPlanProposal) => {
        const subject = fixture();
        const controller = new AbortController();
        let shown!: () => void;
        const displayed = new Promise<void>((resolve) => {
          shown = resolve;
        });
        let liveSignal: AbortSignal | undefined;
        const host = await subject.open((request) => {
          liveSignal = request.signal;
          shown();
          return new Promise((resolve) =>
            request.signal?.addEventListener(
              "abort",
              () => resolve({ outcome: { outcome: "cancelled" } }),
              { once: true }
            )
          );
        });
        const original = {
          ...prompt,
          toolCall: { ...prompt.toolCall, isPlanProposal },
          signal: controller.signal,
        };
        const request = host.request(original);
        await displayed;
        host.dispose({
          preservePending: true,
        });
        expect(liveSignal?.aborted).toBe(true);
        expect(controller.signal.aborted).toBe(false);
        controller.abort(new Error("SDK owner closed"));
        expect(await request).toEqual({ outcome: { outcome: "cancelled" } });
        host.dispose();
        expect(JSON.stringify(subject.document)).not.toContain('"status":"cancelled"');
        const show = jest.fn(
          async (): Promise<PermissionDecision> => ({
            outcome: { outcome: "selected", optionId: "yes" },
          })
        );
        const reopened = await subject.open(show);
        expect(reopened.pending).toHaveLength(1);
        expect(show).not.toHaveBeenCalled();
        expect(
          await reopened.request({ ...original, signal: new AbortController().signal })
        ).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
        expect(show).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(subject.document)).toContain('"consumed":true');
        reopened.dispose();
      }
    );

    it("revalidates a suspended approval against current file facts before recovery and permits Stop to cancel preserved pending work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      let shown!: () => void;
      const displayed = new Promise<void>((resolve) => {
        shown = resolve;
      });
      const host = await subject.open(async () => {
        shown();
        return new Promise<never>(() => undefined);
      });
      const request = host.request(prompt);
      await displayed;
      host.dispose({
        preservePending: true,
      });
      host.dispose();
      expect(await request).toEqual({ outcome: { outcome: "cancelled" } });
      const reopened = await subject.open();
      expect(reopened.pending).toHaveLength(1);
      subject.valid = false;
      await reopened.prepareRecovery();
      expect(reopened.pending).toEqual([]);
      expect(JSON.stringify(subject.document)).toContain('"status":"stale"');
      reopened.dispose();
      subject.valid = true;
      let shownAgain!: () => void;
      const displayedAgain = new Promise<void>((resolve) => {
        shownAgain = resolve;
      });
      const next = await subject.open(async () => {
        shownAgain();
        return new Promise<never>(() => undefined);
      });
      const pending = next.request(prompt);
      await displayedAgain;
      next.dispose({
        preservePending: true,
      });
      await next.cancelAll();
      expect(await pending).toEqual({ outcome: { outcome: "cancelled" } });
      expect(JSON.stringify(subject.document)).toContain('"status":"cancelled"');
      next.dispose();
    });

    it("keeps a normal UI approval committed while withdrawing only its completed live window https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      const controller = new AbortController();
      let liveSignal: AbortSignal | undefined;
      const host = await subject.open(async (request) => {
        liveSignal = request.signal;
        return { outcome: { outcome: "selected", optionId: "yes" } };
      });
      expect(await host.request({ ...prompt, signal: controller.signal })).toEqual({
        outcome: { outcome: "selected", optionId: "yes" },
      });
      expect(liveSignal).toBeDefined();
      expect(liveSignal).not.toBe(controller.signal);
      expect(liveSignal?.aborted).toBe(true);
      expect(controller.signal.aborted).toBe(false);
      expect(JSON.stringify(subject.document)).toContain('"consumed":true');
      expect(JSON.stringify(subject.document)).not.toContain('"status":"cancelled"');
      host.dispose();
    });

    it("forwards outside cancellation to the live window and retires the pending approval https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      const controller = new AbortController();
      let shown!: () => void;
      const displayed = new Promise<void>((resolve) => {
        shown = resolve;
      });
      let liveSignal: AbortSignal | undefined;
      const host = await subject.open((request) => {
        liveSignal = request.signal;
        shown();
        return new Promise<PermissionDecision>((resolve) =>
          request.signal?.addEventListener(
            "abort",
            () => resolve({ outcome: { outcome: "cancelled" } }),
            { once: true }
          )
        );
      });
      const pending = host.request({ ...prompt, signal: controller.signal });
      await displayed;
      controller.abort();
      expect(await pending).toEqual({ outcome: { outcome: "cancelled" } });
      expect(liveSignal).not.toBe(controller.signal);
      expect(liveSignal?.aborted).toBe(true);
      expect(host.pending).toEqual([]);
      expect(JSON.stringify(subject.document)).toContain('"status":"cancelled"');
      expect(JSON.stringify(subject.document)).not.toContain('"consumed":true');
      host.dispose();
    });

    it("does not save or show an approval whose outside signal was already cancelled https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      const controller = new AbortController();
      controller.abort();
      const show = jest.fn();
      const host = await subject.open(show);
      expect(await host.request({ ...prompt, signal: controller.signal })).toEqual({
        outcome: { outcome: "cancelled" },
      });
      expect(show).not.toHaveBeenCalled();
      expect(subject.entries).toEqual([]);
      expect(host.pending).toEqual([]);
      host.dispose();
    });

    it("withdraws a late live card after the committed projection approval already allowed exactly one operation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      let host!: Awaited<ReturnType<typeof createPiRuntimeApprovals>>;
      let handler!: SessionUpdateHandler;
      const backend = {
        registerSessionHandler: (_id: string, next: SessionUpdateHandler) => {
          handler = next;
          return () => undefined;
        },
        decidePermission: jest.fn(
          async ({ requestId, decision }: { requestId: string; decision: PermissionDecision }) =>
            host.decide(requestId, decision)
        ),
        prompt: jest.fn(),
      } as unknown as BackendProcess;
      const session = new AgentSession({
        backend,
        backendSessionId: "root",
        internalId: "ui",
        backendId: "pi",
      });
      session.completeResume(null);
      let openLive!: () => void;
      const liveGate = new Promise<void>((resolve) => {
        openLive = resolve;
      });
      let reportLiveOpened!: () => void;
      const liveOpened = new Promise<void>((resolve) => {
        reportLiveOpened = resolve;
      });
      const show = jest.fn(async (request: PermissionPrompt) => {
        await liveGate;
        const response = session.handleToolPermission(request);
        reportLiveOpened();
        return response;
      });
      host = await subject.open(show);
      let frameIndex = 0;
      let selected = false;
      let committedDecision: Promise<void> | undefined;
      subject.emit.mockImplementation(() => {
        handler({
          sessionId: "root",
          update: {
            sessionUpdate: "session_projection",
            projection: {
              cursor: { streamEpoch: "approvals", frameIndex: ++frameIndex },
              mode: "replace",
              messages: [],
              pending: { permissions: host.pending, questions: [], plan: null, recovery: null },
            },
          },
        });
        if (!selected && host.pending.length) {
          selected = true;
          committedDecision = session.resolveToolPermission("original-call", "yes");
        }
      });
      const operation = jest.fn();
      const decision = await host.request(prompt);
      await committedDecision;
      expect(decision).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
      operation();
      openLive();
      await liveOpened;
      expect(session.getPendingToolPermissions()).toEqual([]);
      expect(session.getStatus()).toBe("idle");
      expect(backend.decidePermission).toHaveBeenCalledTimes(1);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(subject.document)).toContain('"consumed":true');
      expect(JSON.stringify(subject.document)).not.toContain('"status":"cancelled"');
      expect(backend.prompt).not.toHaveBeenCalled();
      await session.dispose();
      host.dispose();
    });
    it("durably cancels an approval when Stop arrives after the decision but before consumption https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      const controller = new AbortController();
      subject.emit.mockImplementation(() => {
        if (JSON.stringify(subject.document).includes('"decidedAtMs"')) controller.abort();
      });
      const host = await subject.open(async () => ({
        outcome: { outcome: "selected", optionId: "yes" },
      }));
      expect(await host.request({ ...prompt, signal: controller.signal })).toEqual({
        outcome: { outcome: "cancelled" },
      });
      expect(JSON.stringify(subject.document)).toContain('"status":"cancelled"');
      expect(JSON.stringify(subject.document)).not.toContain('"consumed":true');
      host.dispose();
    });

    it("withdraws a durably pending card when its actual permission window fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      const host = await subject.open(async () => {
        throw new Error("window closed");
      });
      await expect(host.request(prompt)).rejects.toThrow("window closed");
      expect(host.pending).toEqual([]);
      expect(JSON.stringify(subject.document)).toContain('"status":"cancelled"');
      host.dispose();
    });
    it("reloads original pending cards without prompting or running work and saves an explicit decision before reusing it https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      let shown!: () => void;
      const displayed = new Promise<void>((resolve) => {
        shown = resolve;
      });
      const first = await subject.open(
        jest.fn(() => {
          shown();
          return new Promise<never>(() => undefined);
        })
      );
      const pending = first.request(prompt);
      await displayed;
      const show = jest.fn();
      const reopened = await subject.open(show);
      expect(show).not.toHaveBeenCalled();
      expect(reopened.pending).toEqual([prompt]);
      expect(reopened.recoveryApprovals()).toMatchObject([
        { requestId: "original-call", state: "pending" },
      ]);
      await reopened.decide("original-call", { outcome: { outcome: "selected", optionId: "yes" } });
      expect(JSON.stringify(subject.document)).toContain('"consumed":false');
      expect(await reopened.request(prompt)).toEqual({
        outcome: { outcome: "selected", optionId: "yes" },
      });
      expect(show).not.toHaveBeenCalled();
      expect(JSON.stringify(subject.document)).toContain('"consumed":true');
      first.dispose();
      expect(await pending).toEqual({ outcome: { outcome: "cancelled" } });
      reopened.dispose();
    });

    it("requires a fresh approval after baseline or policy changes and ignores a late answer after Stop https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      let answer!: (value: { outcome: { outcome: "selected"; optionId: string } }) => void;
      let shown!: () => void;
      const displayed = new Promise<void>((resolve) => {
        shown = resolve;
      });
      const host = await subject.open(
        jest.fn(() => {
          shown();
          return new Promise<{ outcome: { outcome: "selected"; optionId: string } }>((resolve) => {
            answer = resolve;
          });
        })
      );
      const pending = host.request(prompt);
      await displayed;
      await host.cancelAll();
      answer({ outcome: { outcome: "selected", optionId: "yes" } });
      expect(await pending).toEqual({ outcome: { outcome: "cancelled" } });
      expect(JSON.stringify(subject.document)).toContain('"status":"cancelled"');
      expect(host.pending).toEqual([]);
      const reopened = await subject.open(
        jest.fn(
          async (): Promise<PermissionDecision> => ({
            outcome: { outcome: "selected", optionId: "yes" },
          })
        )
      );
      expect(await reopened.request(prompt)).toEqual({
        outcome: { outcome: "selected", optionId: "yes" },
      });
      host.dispose();
      reopened.dispose();
    });

    it("retires outdated approvals before recovery without executing and preserves a failed decision as pending https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = fixture();
      let shown!: () => void;
      const displayed = new Promise<void>((resolve) => {
        shown = resolve;
      });
      const host = await subject.open(
        jest.fn(() => {
          shown();
          return new Promise<never>(() => undefined);
        })
      );
      const pending = host.request(prompt);
      await displayed;
      subject.failure = true;
      await expect(
        host.decide("original-call", { outcome: { outcome: "selected", optionId: "yes" } })
      ).rejects.toThrow("disk unavailable");
      expect(host.pending).toEqual([prompt]);
      subject.failure = false;
      subject.policy = "changed";
      subject.valid = false;
      await host.prepareRecovery();
      expect(host.recoveryApprovals()).toEqual([]);
      expect(host.pending).toEqual([]);
      expect(JSON.stringify(subject.document)).toContain('"status":"stale"');
      host.dispose();
      expect(await pending).toEqual({ outcome: { outcome: "cancelled" } });
    });
  });
});
