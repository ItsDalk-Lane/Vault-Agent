import {
  SUBAGENT_MAX_CONCURRENT_PER_ROOT,
  SUBAGENT_MAX_DEPTH,
  SubagentScheduler,
  type SubagentDispatchResult,
} from "@/agentMode/sdk/pi/features/subagents/SubagentScheduler";

// At most three children run per root and the fourth waits in a cancellable queue that has sent
// nothing, depth 2 never delegates further, a total root budget really stops subagents, a revoked
// parent permission blocks the next call immediately, and two writers on one path serialize through
// the shared path lock so they cannot overwrite each other:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
interface DispatchCall {
  readonly taskId: string;
  readonly startedAtMs: number;
  endedAtMs: number;
}

class FakeDispatcher {
  readonly calls: DispatchCall[] = [];
  readonly started: string[] = [];
  private readonly pending = new Map<
    string,
    { resolve: (result: SubagentDispatchResult) => void; call: DispatchCall }
  >();
  autoComplete = false;
  private clock = 0;

  dispatch = async (input: { taskId: string }): Promise<SubagentDispatchResult> => {
    this.clock += 1;
    const call: DispatchCall = {
      taskId: input.taskId,
      startedAtMs: this.clock,
      endedAtMs: 0,
    };
    this.calls.push(call);
    this.started.push(input.taskId);
    if (this.autoComplete) {
      this.clock += 1;
      call.endedAtMs = this.clock;
      return { status: "completed" };
    }
    return new Promise<SubagentDispatchResult>((resolve) => {
      this.pending.set(input.taskId, { resolve, call });
    });
  };

  complete(taskId: string, status: "completed" | "failed" | "cancelled" = "completed"): void {
    const entry = this.pending.get(taskId);
    if (entry === undefined) throw new Error(`not running: ${taskId}`);
    this.pending.delete(taskId);
    this.clock += 1;
    entry.call.endedAtMs = this.clock;
    entry.resolve({ status });
  }
}

function scheduler(
  dispatcher: FakeDispatcher,
  options: {
    revoked?: (input: { rootId: string }) => boolean;
  } = {}
): SubagentScheduler {
  return new SubagentScheduler({
    dispatch: dispatcher.dispatch,
    ...(options.revoked !== undefined ? { isPermissionRevoked: options.revoked } : {}),
    now: () => 1_000,
  });
}

function schedule(
  subject: SubagentScheduler,
  taskId: string,
  overrides: Record<string, unknown> = {}
) {
  return subject.schedule({
    taskId,
    rootId: "root-1",
    profileId: "researcher",
    depth: 1,
    ...overrides,
  });
}

describe("SubagentScheduler", () => {
  describe("SubagentScheduler", () => {
    describe("yieldWhile()", () => {
      it("lets a waiting parent release its slot so a depth-two child can run, then reacquires before continuing https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const dispatcher = new FakeDispatcher();
        const subject = scheduler(dispatcher);
        for (const id of ["parent", "peer-1", "peer-2"]) await schedule(subject, id);
        let finishWait!: () => void;
        let childAdmitted!: () => void;
        const admitted = new Promise<void>((resolve) => {
          childAdmitted = resolve;
        });
        const waiting = subject.yieldWhile("parent", async () => {
          await schedule(subject, "grandchild", { depth: 2 });
          await subject.started("grandchild");
          expect(subject.activeCount("root-1")).toBe(3);
          childAdmitted();
          await new Promise<void>((resolve) => {
            finishWait = resolve;
          });
        });
        await admitted;
        expect(dispatcher.started).toEqual(["parent", "peer-1", "peer-2", "grandchild"]);
        finishWait();
        dispatcher.complete("grandchild");
        await waiting;
        expect(subject.activeCount("root-1")).toBe(3);
        for (const id of ["parent", "peer-1", "peer-2"]) dispatcher.complete(id);
        await subject.drain();
      });

      it("does not reacquire a waiting parent's slot after cancellation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const dispatcher = new FakeDispatcher();
        const subject = scheduler(dispatcher);
        await schedule(subject, "parent");
        let started!: () => void;
        const actionStarted = new Promise<void>((resolve) => {
          started = resolve;
        });
        let release!: () => void;
        const action = new Promise<void>((resolve) => {
          release = resolve;
        });
        const yielding = subject.yieldWhile("parent", async () => {
          started();
          await action;
        });
        await actionStarted;
        await subject.cancel("parent");
        release();
        await yielding;
        dispatcher.complete("parent");
        await subject.drain();
        expect(subject.list("root-1")[0]?.state).toBe("cancelled");
        expect(subject.queuedCount("root-1")).toBe(0);
      });

      it("preserves action failures and leaves no slot for an unknown task https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const subject = scheduler(new FakeDispatcher());
        await expect(
          subject.yieldWhile("missing", async () => {
            throw new Error("read failed");
          })
        ).rejects.toThrow("read failed");
        expect(subject.activeCount("root-1")).toBe(0);
        await subject.drain();
      });
    });

    describe("schedule()", () => {
      it("releases a failed dispatch slot and admits the next child https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let fail!: (error: Error) => void;
        const first = new Promise<never>((_resolve, reject) => {
          fail = reject;
        });
        const subject = new SubagentScheduler({
          maxConcurrent: 1,
          dispatch: async ({ taskId }) => {
            if (taskId === "first") return first;
            return { status: "completed" };
          },
        });
        await schedule(subject, "first");
        await schedule(subject, "second");
        fail(new Error("provider failed"));
        await subject.started("second");
        await subject.drain();
        expect(subject.list("root-1").map((record) => record.state)).toEqual([
          "failed",
          "completed",
        ]);
      });

      it("records a failed admission and remains drainable when permission lookup fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const dispatch = jest.fn(async () => ({ status: "completed" as const }));
        const subject = new SubagentScheduler({
          dispatch,
          isPermissionRevoked: async () => {
            throw new Error("permission store failed");
          },
        });
        expect((await schedule(subject, "permission-failure")).state).toBe("failed");
        await subject.drain();
        expect(dispatch).not.toHaveBeenCalled();
      });

      it("cancels admission while its permission check is pending without dispatching the child https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let decide!: (revoked: boolean) => void;
        const permission = new Promise<boolean>((resolve) => {
          decide = resolve;
        });
        const dispatch = jest.fn(async () => ({ status: "completed" as const }));
        const subject = new SubagentScheduler({
          isPermissionRevoked: () => permission,
          dispatch,
        });
        const waiting = schedule(subject, "pending-permission");
        await subject.cancel("pending-permission");
        decide(false);
        expect((await waiting).state).toBe("cancelled");
        expect(dispatch).not.toHaveBeenCalled();
        await subject.drain();
      });

      it("keeps the three-child limit when four tools schedule simultaneously https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const dispatcher = new FakeDispatcher();
        const subject = scheduler(dispatcher);
        await Promise.all(["p1", "p2", "p3", "p4"].map((id) => schedule(subject, id)));
        expect(subject.activeCount("root-1")).toBe(3);
        expect(subject.queuedCount("root-1")).toBe(1);
        dispatcher.complete("p1");
        await subject.started("p4");
        for (const id of ["p2", "p3", "p4"]) dispatcher.complete(id);
        await subject.drain();
      });

      it("runs three children per root and really queues the fourth", async () => {
        const dispatcher = new FakeDispatcher();
        const subject = scheduler(dispatcher);

        await schedule(subject, "t1");
        await schedule(subject, "t2");
        await schedule(subject, "t3");
        await subject.started("t1");
        await subject.started("t2");
        await subject.started("t3");
        const fourth = await schedule(subject, "t4");

        expect(SUBAGENT_MAX_CONCURRENT_PER_ROOT).toBe(3);
        expect(dispatcher.started).toEqual(["t1", "t2", "t3"]);
        expect(fourth.state).toBe("queued");
        expect(subject.activeCount("root-1")).toBe(3);
        expect(subject.queuedCount("root-1")).toBe(1);

        dispatcher.complete("t1");
        await subject.started("t4");
        dispatcher.complete("t2");
        dispatcher.complete("t3");
        dispatcher.complete("t4");
        await subject.drain();

        expect(dispatcher.started).toEqual(["t1", "t2", "t3", "t4"]);
        expect(subject.list("root-1").find((record) => record.taskId === "t4")?.state).toBe(
          "completed"
        );
      });

      it("cancels a queued child without ever sending a request", async () => {
        const dispatcher = new FakeDispatcher();
        const subject = scheduler(dispatcher);
        await schedule(subject, "t1");
        await schedule(subject, "t2");
        await schedule(subject, "t3");
        await subject.started("t1");
        await subject.started("t2");
        await subject.started("t3");
        await schedule(subject, "t4");

        const cancelled = await subject.cancel("t4");
        dispatcher.complete("t1");
        dispatcher.complete("t2");
        dispatcher.complete("t3");
        await subject.drain();

        expect(cancelled.state).toBe("cancelled");
        expect(dispatcher.started).toEqual(["t1", "t2", "t3"]);
        expect(subject.queuedCount("root-1")).toBe(0);
      });

      it("blocks the next child immediately after the parent permission is revoked", async () => {
        const dispatcher = new FakeDispatcher();
        let revoked = false;
        const subject = scheduler(dispatcher, { revoked: () => revoked });
        await schedule(subject, "t1");
        await schedule(subject, "t2");
        await schedule(subject, "t3");
        await subject.started("t1");
        await subject.started("t2");
        await subject.started("t3");
        await schedule(subject, "t4");

        revoked = true;
        dispatcher.complete("t1");
        await subject.started("t4");
        dispatcher.complete("t2");
        dispatcher.complete("t3");
        await subject.drain();

        expect(dispatcher.started).toEqual(["t1", "t2", "t3"]);
        expect(subject.list("root-1").find((record) => record.taskId === "t4")).toMatchObject({
          state: "blocked",
          blockReason: "permission_revoked",
        });
      });

      it("enforces the depth limit and stops delegating at depth 2", async () => {
        const dispatcher = new FakeDispatcher();
        const subject = scheduler(dispatcher);

        const tooDeep = await schedule(subject, "deep", { depth: SUBAGENT_MAX_DEPTH + 1 });

        expect(tooDeep).toMatchObject({ state: "blocked", blockReason: "depth_limit" });
        expect(dispatcher.started).toEqual([]);
        expect(subject.canDelegate(1)).toBe(true);
        expect(subject.canDelegate(SUBAGENT_MAX_DEPTH)).toBe(false);
      });
    });
  });
});
