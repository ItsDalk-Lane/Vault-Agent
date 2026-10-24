import {
  RunBudget,
  createAttemptId,
  type BudgetReserveRecord,
  type ModelRequestPurpose,
} from "@/agentMode/sdk/pi/runtime/RunBudget";
import {
  ProviderGuard,
  type GuardFailure,
  type GuardRequest,
  type RunDispatchState,
  type ProviderGuardOptions,
} from "./ProviderGuard";

// One hard gate in front of every model dispatch: root/run, cancel epoch, conversation
// mapping, endpoint fingerprint and credential availability are checked, then a durable
// budget reserve commits with a stable attemptId, and only after that is the network stream
// created. A denied gate produces a proper error stream and sends nothing:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const NOW = 1_700_000_000_000;

function createBudget(
  overrides: Partial<{
    maxModelAttempts: number;
    maxActiveSubagents: number;
    maxBudgetUsd: number | null;
    persistFailure: boolean;
  }> = {}
): RunBudget & { readonly persisted: BudgetReserveRecord[] } {
  const persisted: BudgetReserveRecord[] = [];
  const budget = new RunBudget({
    limits: {
      maxModelAttempts: overrides.maxModelAttempts ?? 32,
      maxActiveSubagents: overrides.maxActiveSubagents ?? 3,
      maxBudgetUsd: overrides.maxBudgetUsd ?? null,
    },
    now: () => NOW,
    persistReserve: async (record) => {
      if (overrides.persistFailure) throw new Error("durable reserve failed");
      persisted.push(record);
      return { accepted: true };
    },
  }) as RunBudget & { readonly persisted: BudgetReserveRecord[] };
  Object.defineProperty(budget, "persisted", { value: persisted });
  return budget;
}

function dispatchState(overrides: Partial<RunDispatchState> = {}): RunDispatchState {
  return {
    rootId: "root-1",
    runId: "run-1",
    conversationId: "conversation-1",
    state: "active",
    cancelEpoch: 3,
    endpointFingerprint: "anthropic-messages|https://api.example.com/v1",
    ...overrides,
  };
}

interface GuardWorld {
  networkCalls: GuardRequest[];
  errorStreams: GuardFailure[];
  state: RunDispatchState | null;
  resolveFailure: Error | null;
  resolveStarted: Promise<void>;
  readonly markResolveStarted: () => void;
}

function createGuardWorld(): GuardWorld {
  let markResolveStarted: () => void = () => undefined;
  const resolveStarted = new Promise<void>((resolve) => {
    markResolveStarted = resolve;
  });
  return {
    networkCalls: [],
    errorStreams: [],
    state: dispatchState(),
    resolveFailure: null,
    resolveStarted,
    markResolveStarted,
  };
}

function createGuard(
  world: GuardWorld,
  options: {
    budget?: RunBudget;
    credentialAvailable?: () => Promise<boolean>;
    onBudgetDenied?: (failure: GuardFailure) => Promise<never>;
    beforeNetworkOpen?: () => void;
    openNetworkStream?: ProviderGuardOptions<string>["openNetworkStream"];
  } = {}
): ProviderGuard<string> {
  return new ProviderGuard<string>({
    budget: options.budget ?? createBudget(),
    onBudgetDenied: options.onBudgetDenied,
    beforeNetworkOpen: options.beforeNetworkOpen,
    resolveRun: async () => {
      world.markResolveStarted();
      if (world.resolveFailure) throw world.resolveFailure;
      return world.state;
    },
    credentialAvailable: options.credentialAvailable ?? (async () => true),
    createErrorStream: (failure) => {
      world.errorStreams.push(failure);
      return `error:${failure.code}`;
    },
    openNetworkStream:
      options.openNetworkStream ??
      ((request) => {
        world.networkCalls.push(request);
        return `network:${request.attemptId}`;
      }),
  });
}

function guardRequest(overrides: Partial<GuardRequest> = {}): GuardRequest {
  return {
    rootId: "root-1",
    runId: "run-1",
    conversationId: "conversation-1",
    cancelEpoch: 3,
    endpointFingerprint: "anthropic-messages|https://api.example.com/v1",
    providerInstanceId: "provider-1",
    modelId: "model-1",
    purpose: "root",
    attemptId: createAttemptId({ runId: "run-1", purpose: "root", sequence: 1 }),
    ...overrides,
  };
}

describe("RunBudget", () => {
  it("reserves a durable attempt with a stable id and rejects an exhausted budget", async () => {
    const budget = createBudget({ maxModelAttempts: 1 });
    const first = createAttemptId({ runId: "run-1", purpose: "root", sequence: 1 });

    await expect(
      budget.reserve({ attemptId: first, runId: "run-1", purpose: "root" })
    ).resolves.toEqual({ kind: "reserved", attemptId: first, purpose: "root" });
    await expect(
      budget.reserve({ attemptId: first, runId: "run-1", purpose: "root" })
    ).resolves.toEqual({ kind: "already_reserved", attemptId: first });
    expect(budget.snapshot.modelAttempts).toBe(1);
    expect(budget.persisted).toHaveLength(1);

    await expect(
      budget.reserve({
        attemptId: createAttemptId({ runId: "run-1", purpose: "root", sequence: 2 }),
        runId: "run-1",
        purpose: "root",
      })
    ).resolves.toMatchObject({ kind: "denied", code: "BUDGET_EXCEEDED" });
    expect(budget.snapshot.modelAttempts).toBe(1);
  });

  it("does not admit a request when the durable reserve commit fails", async () => {
    const budget = createBudget({ persistFailure: true });
    const result = await budget.reserve({
      attemptId: createAttemptId({ runId: "run-1", purpose: "root", sequence: 1 }),
      runId: "run-1",
      purpose: "root",
    });

    expect(result).toMatchObject({ kind: "denied", code: "BUDGET_EXCEEDED" });
    expect(budget.snapshot.modelAttempts).toBe(0);
  });

  it("serializes concurrent subagent reservations so the active limit is not exceeded", async () => {
    const budget = createBudget({ maxActiveSubagents: 2 });
    const attempts = [1, 2, 3].map((sequence) =>
      createAttemptId({ runId: "run-1", purpose: "subagent", sequence })
    );

    const results = await Promise.all(
      attempts.map((attemptId) =>
        budget.reserve({ attemptId, runId: "run-1", purpose: "subagent" })
      )
    );

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(2);
    expect(results.filter((result) => result.kind === "denied")).toHaveLength(1);
    expect(budget.snapshot.activeSubagents).toBe(2);

    await budget.settle(attempts[0], { kind: "failed" });
    await expect(
      budget.reserve({ attemptId: attempts[2], runId: "run-1", purpose: "subagent" })
    ).resolves.toMatchObject({ kind: "reserved" });
  });

  it("refunds a reservation that never reached the network", async () => {
    const budget = createBudget({ maxActiveSubagents: 1 });
    const attemptId = createAttemptId({ runId: "run-1", purpose: "subagent", sequence: 1 });
    await budget.reserve({ attemptId, runId: "run-1", purpose: "subagent" });

    await budget.refund(attemptId);

    expect(budget.snapshot).toMatchObject({ modelAttempts: 0, activeSubagents: 0 });
    await expect(
      budget.reserve({ attemptId, runId: "run-1", purpose: "subagent" })
    ).resolves.toMatchObject({ kind: "reserved" });
  });

  it("stops admitting requests when the USD budget is spent and flags unknown costs", async () => {
    const budget = createBudget({ maxBudgetUsd: 1 });
    const first = createAttemptId({ runId: "run-1", purpose: "root", sequence: 1 });
    await budget.reserve({ attemptId: first, runId: "run-1", purpose: "root" });
    await budget.recordUsage(first, { usd: null });

    expect(budget.snapshot).toMatchObject({ spentUsd: 0, unknownCost: true });

    await budget.recordUsage(first, { usd: 1 });
    await expect(
      budget.reserve({
        attemptId: createAttemptId({ runId: "run-1", purpose: "root", sequence: 2 }),
        runId: "run-1",
        purpose: "root",
      })
    ).resolves.toMatchObject({ kind: "denied", code: "BUDGET_EXCEEDED" });
  });

  it("mints stable attempt ids per run, purpose and sequence", () => {
    const first = createAttemptId({ runId: "run-1", purpose: "compaction", sequence: 2 });
    expect(first).toBe(createAttemptId({ runId: "run-1", purpose: "compaction", sequence: 2 }));
    expect(first).not.toBe(createAttemptId({ runId: "run-2", purpose: "compaction", sequence: 2 }));
    expect(first).not.toBe(createAttemptId({ runId: "run-1", purpose: "title", sequence: 2 }));
    expect(first).not.toBe(createAttemptId({ runId: "run-1", purpose: "compaction", sequence: 3 }));
    expect(first).toMatch(/^attempt-/);
  });
});

describe("ProviderGuard", () => {
  describe("dispatch()", () => {
    it("refunds the committed reservation when the final permission gate refuses before any stream opens https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const world = createGuardWorld();
      const budget = createBudget({ maxModelAttempts: 1 });
      const guard = createGuard(world, {
        budget,
        beforeNetworkOpen: () => {
          expect(budget.snapshot.modelAttempts).toBe(1);
          throw new Error("credential revoked before network open");
        },
      });
      await expect(guard.dispatch(guardRequest())).rejects.toThrow(
        "credential revoked before network open"
      );
      expect(world.networkCalls).toEqual([]);
      expect(budget.snapshot.modelAttempts).toBe(0);
    });
    it("retains the reservation if opening the actual network stream throws because transmission cannot be ruled out https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const world = createGuardWorld();
      const budget = createBudget({ maxModelAttempts: 1 });
      const guard = createGuard(world, {
        budget,
        openNetworkStream: (request) => {
          world.networkCalls.push(request);
          throw new Error("network factory failed");
        },
      });
      await expect(guard.dispatch(guardRequest())).rejects.toThrow("network factory failed");
      expect(world.networkCalls).toHaveLength(1);
      expect(budget.snapshot.modelAttempts).toBe(1);
    });
  });

  it("produces an error stream and no network request when the budget is exhausted", async () => {
    const world = createGuardWorld();
    const budget = createBudget({ maxModelAttempts: 0 });
    const guard = createGuard(world, { budget });

    const stream = await guard.dispatch(guardRequest());

    expect(stream).toBe("error:BUDGET_EXCEEDED");
    expect(world.networkCalls).toEqual([]);
    expect(world.errorStreams).toEqual([{ code: "BUDGET_EXCEEDED", message: expect.any(String) }]);
  });

  it("hands exhausted work to the owner pause protocol without creating an ordinary error response https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
    const world = createGuardWorld();
    let reached!: () => void;
    const denied = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const controller = new AbortController();
    const guard = createGuard(world, {
      budget: createBudget({ maxModelAttempts: 0 }),
      onBudgetDenied: async (failure) => {
        expect(failure.code).toBe("BUDGET_EXCEEDED");
        reached();
        return new Promise<never>((_resolve, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("owner closed with durable work preserved")),
            { once: true }
          )
        );
      },
    });
    const dispatch = guard.dispatch(guardRequest());
    await denied;
    expect(world.networkCalls).toEqual([]);
    expect(world.errorStreams).toEqual([]);
    controller.abort();
    await expect(dispatch).rejects.toThrow("durable work preserved");
  });

  it("blocks a late request after the run was cancelled", async () => {
    const world = createGuardWorld();
    const guard = createGuard(world);
    world.state = dispatchState({ state: "cancelled" });

    await expect(guard.dispatch(guardRequest())).resolves.toBe("error:CANCELLED");
    expect(world.networkCalls).toEqual([]);
  });

  it("blocks a request whose cancel epoch is stale", async () => {
    const world = createGuardWorld();
    const guard = createGuard(world);

    await expect(guard.dispatch(guardRequest({ cancelEpoch: 2 }))).resolves.toBe("error:CANCELLED");
    expect(world.networkCalls).toEqual([]);
  });

  it("blocks requests with no committed conversation mapping or wrong ownership", async () => {
    const world = createGuardWorld();
    const guard = createGuard(world);

    world.state = null;
    await expect(guard.dispatch(guardRequest())).resolves.toBe("error:STALE_IDENTITY");

    world.state = dispatchState({ rootId: "other-root" });
    await expect(guard.dispatch(guardRequest())).resolves.toBe("error:STALE_IDENTITY");

    world.state = dispatchState({ runId: "other-run" });
    await expect(guard.dispatch(guardRequest())).resolves.toBe("error:STALE_IDENTITY");
    expect(world.networkCalls).toEqual([]);
  });

  it("blocks an endpoint fingerprint mismatch instead of switching endpoints", async () => {
    const world = createGuardWorld();
    const guard = createGuard(world);

    await expect(
      guard.dispatch(
        guardRequest({ endpointFingerprint: "openai-completions|https://other.example.com/v1" })
      )
    ).resolves.toBe("error:ENDPOINT_MISMATCH");
    expect(world.networkCalls).toEqual([]);
  });

  it("blocks requests without an available credential", async () => {
    const world = createGuardWorld();
    const guard = createGuard(world, { credentialAvailable: async () => false });

    await expect(guard.dispatch(guardRequest())).resolves.toBe("error:CREDENTIAL_REQUIRED");
    expect(world.networkCalls).toEqual([]);
  });

  it("does not exceed the concurrent subagent limit for gated dispatches", async () => {
    const world = createGuardWorld();
    const guard = createGuard(world, { budget: createBudget({ maxActiveSubagents: 2 }) });
    const attempts = [1, 2, 3].map((sequence) =>
      createAttemptId({ runId: "run-1", purpose: "subagent", sequence })
    );

    const streams = await Promise.all(
      attempts.map((attemptId) => guard.dispatch(guardRequest({ purpose: "subagent", attemptId })))
    );

    expect(streams.filter((stream) => stream.startsWith("network:"))).toHaveLength(2);
    expect(streams.filter((stream) => stream === "error:SUBAGENT_LIMIT")).toHaveLength(1);
    expect(world.networkCalls).toHaveLength(2);
  });

  it("counts compaction requests against the same budget as user turns", async () => {
    const world = createGuardWorld();
    const guard = createGuard(world, { budget: createBudget({ maxModelAttempts: 1 }) });

    await expect(guard.dispatch(guardRequest())).resolves.toMatch(/^network:/);
    await expect(
      guard.dispatch(
        guardRequest({
          purpose: "compaction",
          attemptId: createAttemptId({ runId: "run-1", purpose: "compaction", sequence: 1 }),
        })
      )
    ).resolves.toBe("error:BUDGET_EXCEEDED");
    expect(world.networkCalls).toHaveLength(1);
  });

  it("counts title, compaction, subagent and fan-out entry points through the same reserve", async () => {
    const world = createGuardWorld();
    const budget = createBudget({ maxModelAttempts: 10 });
    const guard = createGuard(world, { budget });
    const purposes: ModelRequestPurpose[] = ["root", "title", "compaction", "subagent", "fanout"];

    for (const [index, purpose] of purposes.entries()) {
      await guard.dispatch(
        guardRequest({
          purpose,
          attemptId: createAttemptId({ runId: "run-1", purpose, sequence: index + 1 }),
        })
      );
    }

    expect(budget.snapshot.modelAttempts).toBe(purposes.length);
    expect(world.networkCalls).toHaveLength(purposes.length);
  });

  it("refunds the reservation when cancellation arrives between resolve and network open", async () => {
    const world = createGuardWorld();
    const budget = createBudget();
    const guard = createGuard(world, { budget });
    const controller = new AbortController();

    const pending = guard.dispatch(guardRequest({ signal: controller.signal }));
    await world.resolveStarted;
    controller.abort();
    const stream = await pending;

    expect(stream).toBe("error:CANCELLED");
    expect(world.networkCalls).toEqual([]);
    expect(budget.snapshot.modelAttempts).toBe(0);
  });

  it("opens the network stream only once after a successful gate", async () => {
    const world = createGuardWorld();
    const budget = createBudget();
    const guard = createGuard(world, { budget });
    const request = guardRequest();

    const stream = await guard.dispatch(request);

    expect(stream).toBe(`network:${request.attemptId}`);
    expect(world.networkCalls).toHaveLength(1);
    expect(world.networkCalls[0]).toMatchObject({
      providerInstanceId: "provider-1",
      modelId: "model-1",
      runId: "run-1",
      attemptId: request.attemptId,
    });
    expect(budget.snapshot.modelAttempts).toBe(1);
  });
});
