import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  createPiRuntimeRecovery,
  readPiRecoverySnapshot,
  type PiRecoverySnapshot,
  type PiRuntimeRecoveryOptions,
} from "./PiRuntimeRecovery";

let directory: string;
let unfinished = false;
let unknownEffect = false;
let resume: jest.Mock;
let abort: jest.Mock;
let reload: jest.Mock;
let emit: jest.Mock;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-recovery-state-"));
  await fs.writeFile(
    path.join(directory, "meta.json"),
    JSON.stringify({
      kind: "va.store-meta",
      schemaVersion: 1,
      runtimeVersion: "1.3.0",
      createdAt: 1,
    })
  );
  unfinished = false;
  unknownEffect = false;
  resume = jest.fn(async () => undefined);
  abort = jest.fn(async () => {
    unfinished = false;
  });
  reload = jest.fn(async () => ({
    scopeId: "vault",
    policyVersion: 1,
    fileHashes: {},
    bindingHashes: {},
  }));
  emit = jest.fn();
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

function options(): PiRuntimeRecoveryOptions {
  return {
    privateDir: directory,
    inspect: async () => ({
      run: unfinished ? { runId: "run-1", status: "interrupted", startedAtMs: 1 } : null,
      pendingApprovals: [],
      pendingQuestions: 0,
      unknownEffectMutations: unknownEffect
        ? [{ operationId: "op-1", status: "needs_reconciliation" }]
        : [],
    }),
    reloadCredentialsAndPolicy: reload,
    reconcileUnknownEffects: async () => ({ reconciled: !unknownEffect }),
    resume,
    abort,
    emit,
  };
}

function snapshot(): PiRecoverySnapshot {
  return {
    version: 1,
    state: { readOnly: false, model: null, mode: null },
    messages: [
      { id: "answer-1", sender: "ai", timestamp: null, isVisible: true, message: "实际保存的回答" },
    ],
    session: {
      sessionId: "root-1",
      backendId: "pi",
      title: null,
      createdAtMs: 1,
      lastAccessedAtMs: 2,
      messages: [{ role: "assistant", text: "实际保存的回答" }],
    },
  };
}

describe("PiRuntimeRecovery", () => {
  describe("createPiRuntimeRecovery()", () => {
    it("keeps a paused work identity separate from its actual user request identity when offering cold continuation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const recovery = await createPiRuntimeRecovery({
        ...options(),
        inspect: async () => ({
          run: {
            runId: "work-persisted",
            requestId: "request-original",
            status: "paused_user",
            startedAtMs: 1,
          },
          pendingApprovals: [],
          pendingQuestions: 0,
          unknownEffectMutations: [],
        }),
      });
      await recovery.inspect();
      expect(recovery.state).toMatchObject({
        status: "available",
        interruptedRun: {
          runId: "work-persisted",
          requestId: "request-original",
          status: "paused_user",
        },
      });
      expect(resume).not.toHaveBeenCalled();
      expect(recovery.blocked).toBe(true);
    });

    it("offers explicit continuation of a finished SDK segment with remaining work without counting a crash or blocking new user messages https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const recovery = await createPiRuntimeRecovery({
        ...options(),
        inspect: async () => ({
          run: { runId: "work", status: "waiting_user", startedAtMs: 1 },
          pendingApprovals: [],
          pendingQuestions: 0,
          unknownEffectMutations: [],
        }),
      });
      await recovery.inspect();
      expect(recovery.state).toMatchObject({
        status: "available",
        crashLoopTripped: false,
        message: expect.stringContaining("剩余"),
      });
      expect(recovery.blocked).toBe(false);
      expect(() => recovery.assertCanStartWork()).not.toThrow();
      expect(resume).not.toHaveBeenCalled();
      const persisted = JSON.parse(await fs.readFile(path.join(directory, "meta.json"), "utf8"));
      expect(persisted.recovery?.consecutiveAbnormalOpens ?? 0).toBe(0);
    });
    it("shows an unsupported persisted task as read-only and preserves that state after Continue rejects https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const initial = options();
      reload.mockRejectedValueOnce(new Error("任务定义不兼容"));
      const recovery = await createPiRuntimeRecovery({
        ...initial,
        inspect: async () => ({
          run: { runId: "run-unknown", status: "blocked", startedAtMs: 1 },
          pendingApprovals: [],
          pendingQuestions: 0,
          unknownEffectMutations: [],
        }),
      });
      await recovery.inspect();
      expect(recovery.readOnly).toBe(true);
      expect(recovery.state).toMatchObject({
        status: "read_only",
        message: expect.stringContaining("兼容版本"),
      });
      await expect(recovery.recover("continue")).rejects.toThrow("任务定义不兼容");
      expect(recovery.readOnly).toBe(true);
      expect(resume).not.toHaveBeenCalled();
    });
    it("inspects without starting work and admits a clean root https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const recovery = await createPiRuntimeRecovery(options());
      expect(recovery.blocked).toBe(true);
      expect(() => recovery.assertCanStartWork()).toThrow();
      await recovery.inspect();
      expect(recovery.state).toBeNull();
      expect(recovery.readOnly).toBe(false);
      expect(recovery.blocked).toBe(false);
      expect(() => recovery.assertCanStartWork()).not.toThrow();
      expect(resume).not.toHaveBeenCalled();
    });
    it("keeps an admitted live sibling running while a completed peer reaches its safe boundary https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const recovery = await createPiRuntimeRecovery(
        Object.assign(options(), { hasActiveWork: () => true })
      );
      await recovery.inspect();
      unfinished = true;
      await recovery.safeBoundary();
      expect(recovery.blocked).toBe(false);
      expect(recovery.state).toBeNull();
      expect(() => recovery.assertCanStartWork()).not.toThrow();
    });
    it("does not classify a sibling finishing during inspection as abandoned and clears only the next idle boundary https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let active = false;
      const original = options();
      const recovery = await createPiRuntimeRecovery({
        ...original,
        hasActiveWork: () => active,
        inspect: async () => {
          const result = await original.inspect();
          active = false;
          return result;
        },
      });
      await recovery.inspect();
      active = true;
      unfinished = true;
      await recovery.safeBoundary();
      expect(recovery.blocked).toBe(false);
      unfinished = false;
      await recovery.safeBoundary();
      expect(recovery.state).toBeNull();
    });
    it("still pauses unknown mutation effects immediately while a sibling is alive https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const recovery = await createPiRuntimeRecovery(
        Object.assign(options(), { hasActiveWork: () => true })
      );
      await recovery.inspect();
      unfinished = true;
      unknownEffect = true;
      await recovery.safeBoundary();
      expect(recovery.blocked).toBe(true);
      expect(recovery.readOnly).toBe(true);
      expect(recovery.state?.pendingMutationIds).toEqual(["op-1"]);
      expect(() => recovery.assertCanStartWork()).toThrow();
    });
    it("does not bypass cold-open recovery or clear an existing pause because a sibling is active https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      unfinished = true;
      const recovery = await createPiRuntimeRecovery(
        Object.assign(options(), { hasActiveWork: () => true })
      );
      await recovery.inspect();
      expect(recovery.blocked).toBe(true);
      const interrupted = recovery.state;
      unfinished = false;
      await recovery.safeBoundary();
      expect(recovery.blocked).toBe(true);
      expect(recovery.state).toBe(interrupted);
    });
    it("persists abnormal opens and makes the third reopen read-only https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      unfinished = true;
      for (let index = 1; index <= 3; index++) {
        const recovery = await createPiRuntimeRecovery(options());
        await recovery.inspect();
        expect(recovery.blocked).toBe(true);
        expect(recovery.readOnly).toBe(index === 3);
      }
      expect(
        JSON.parse(await fs.readFile(path.join(directory, "meta.json"), "utf8")).recovery
          .consecutiveAbnormalOpens
      ).toBe(3);
    });
    it("only an explicit continue resets a crash loop and publishes running admission before actual resume https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      unfinished = true;
      for (let index = 0; index < 2; index++)
        await (await createPiRuntimeRecovery(options())).inspect();
      const recovery = await createPiRuntimeRecovery(options());
      await recovery.inspect();
      resume.mockImplementation(async () => {
        expect(recovery.blocked).toBe(false);
        expect(recovery.state).toBeNull();
        expect(reload).toHaveBeenCalledTimes(1);
      });
      await recovery.recover("continue");
      expect(resume).toHaveBeenCalledTimes(1);
      expect(recovery.readOnly).toBe(false);
    });
    it("checks unknown file effects without refreshing credentials or resuming an unfinished task https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      unfinished = true;
      unknownEffect = true;
      const reconcile = jest.fn(async () => {
        unknownEffect = false;
        return { reconciled: true };
      });
      const recovery = await createPiRuntimeRecovery({
        ...options(),
        reconcileUnknownEffects: reconcile,
      });
      await recovery.inspect();
      expect(recovery.state?.status).toBe("read_only");
      await recovery.recover("reconcile");
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(recovery.state).toMatchObject({ status: "available", pendingMutationIds: [] });
      expect(recovery.blocked).toBe(true);
      expect(resume).not.toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it("awaits actual abort and clears recovery at a safe boundary https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      unfinished = true;
      const recovery = await createPiRuntimeRecovery(options());
      await recovery.inspect();
      await recovery.recover("abort");
      expect(abort).toHaveBeenCalledTimes(1);
      expect(recovery.blocked).toBe(false);
      expect(recovery.state).toBeNull();
      expect(resume).not.toHaveBeenCalled();
      await recovery.safeBoundary();
      expect(recovery.readOnly).toBe(false);
    });
    it("blocks unresolved effects and restores recovery when refreshing policy fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      unfinished = true;
      unknownEffect = true;
      const recovery = await createPiRuntimeRecovery(options());
      await recovery.inspect();
      expect(recovery.state?.pendingMutationIds).toEqual(["op-1"]);
      await expect(recovery.recover("continue")).rejects.toThrow("needs_reconciliation");
      expect(recovery.blocked).toBe(true);
      expect(resume).not.toHaveBeenCalled();
      unknownEffect = false;
      reload.mockRejectedValueOnce(new Error("credential unavailable"));
      await expect(recovery.recover("continue")).rejects.toThrow("credential unavailable");
      expect(recovery.state?.status).toBe("read_only");
      unknownEffect = true;
      await recovery.recover("abort");
      expect(recovery.readOnly).toBe(true);
      expect(recovery.blocked).toBe(true);
      expect(recovery.state?.pendingMutationIds).toEqual(["op-1"]);
    });
    it("blocks I/O and reports storage failures even when no caller starts another operation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const recovery = await createPiRuntimeRecovery(options());
      await recovery.inspect();
      await recovery.storageFailed(new Error("disk full"));
      expect(recovery.readOnly).toBe(true);
      expect(recovery.blocked).toBe(true);
      expect(recovery.state?.status).toBe("storage_failed");
      expect(() => recovery.assertCanStartWork()).toThrow("storage_failed");
    });
    it("atomically saves the real display history and flushes admitted writes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const recovery = await createPiRuntimeRecovery(options());
      await recovery.saveSnapshot(snapshot());
      await recovery.flush();
      expect(await readPiRecoverySnapshot(directory)).toEqual(snapshot());
      expect((await fs.readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
    });
  });
  describe("readPiRecoverySnapshot()", () => {
    it("returns a verified prior answer and rejects absent, malformed or future snapshots https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      await expect(readPiRecoverySnapshot(directory)).rejects.toThrow();
      const target = path.join(directory, "recovery-view.json");
      await fs.writeFile(target, "broken");
      await expect(readPiRecoverySnapshot(directory)).rejects.toThrow();
      await fs.writeFile(target, JSON.stringify({ ...snapshot(), version: 2 }));
      await expect(readPiRecoverySnapshot(directory)).rejects.toThrow("可验证的兼容历史快照");
      await fs.writeFile(target, JSON.stringify(snapshot()));
      expect((await readPiRecoverySnapshot(directory)).session.messages[0].text).toBe(
        "实际保存的回答"
      );
    });
  });
});
