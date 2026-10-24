import type { Harness } from "@earendil-works/pi-durable";
import { createMcpEffectGuard } from "./McpEffectGuard";
import { createToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";

jest.mock(
  "@earendil-works/pi-durable",
  () => ({ defineDoc: (definition: unknown) => ({ definition }) }),
  { virtual: true }
);
jest.mock("@earendil-works/chord/context", () => ({ BACKGROUND_CONTEXT: {} }), { virtual: true });

function store() {
  interface State {
    operations: Record<string, unknown>;
  }
  let state: State | undefined;
  const commit = jest.fn(async (apply: (tx: { doc: () => Promise<State> }) => Promise<unknown>) => {
    const draft = JSON.parse(JSON.stringify(state ?? { operations: {} })) as State;
    const result = await apply({ doc: async () => draft });
    state = draft;
    return result;
  });
  const conversation = jest.fn(async () => ({ commit }));
  return {
    commit,
    conversation,
    harness: { snapshot: async () => state, conversation } as unknown as Pick<
      Harness,
      "snapshot" | "conversation"
    >,
  };
}

function outcome(operationId: string, effect: "unknown" | "applied" | "not_applied" = "unknown") {
  return createToolOutcome({
    operationId,
    toolId: "external",
    caller: "root",
    success: effect === "applied",
    effect,
  });
}

describe("McpEffectGuard", () => {
  describe("createMcpEffectGuard()", () => {
    it("persists an unknown outcome before dispatch, isolates other services and releases a service only on a saved known result https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const memory = store();
      const guard = await createMcpEffectGuard({ harness: memory.harness, conversationId: "1" });
      expect(guard.recovery.decisions).toEqual([]);
      expect(guard.recovery.decisions).toBe(guard.recovery.decisions);
      expect(await guard.begin("service-a", outcome("a-1"))).toBe(true);
      expect(await guard.begin("service-a", outcome("a-2"))).toBe(false);
      expect(await guard.begin("service-b", outcome("b-1"))).toBe(true);
      await guard.complete("service-a", outcome("a-1", "applied"));
      expect(await guard.begin("service-a", outcome("a-1"))).toBe(false);
      expect(await guard.begin("service-a", outcome("a-2"))).toBe(true);
      await guard.complete("service-a", outcome("a-2", "not_applied"));
      expect(guard.recovery.decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operationId: "a-1", canContinue: true, effect: "applied" }),
          expect.objectContaining({ operationId: "b-1", canContinue: false, effect: "unknown" }),
        ])
      );
    });
    it("restores unresolved outcomes and a read-only reconciliation never changes remote effect facts or retries an operation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const memory = store();
      const first = await createMcpEffectGuard({ harness: memory.harness, conversationId: "1" });
      await first.begin("service-a", outcome("a-1"));
      const restored = await createMcpEffectGuard({ harness: memory.harness, conversationId: "1" });
      const writes = memory.commit.mock.calls.length;
      expect((await restored.reconcile()).decisions).toEqual([
        { operationId: "a-1", serverId: "service-a", effect: "unknown", canContinue: false },
      ]);
      expect(memory.commit).toHaveBeenCalledTimes(writes);
      expect(await restored.begin("service-a", outcome("a-2"))).toBe(false);
    });
    it("refuses a completion without its original operation and propagates storage or owner failures https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const memory = store();
      const guard = await createMcpEffectGuard({ harness: memory.harness, conversationId: "1" });
      await expect(guard.complete("service-a", outcome("missing", "applied"))).rejects.toThrow(
        "原始持久记录"
      );
      memory.commit.mockRejectedValueOnce(new Error("disk unavailable"));
      await expect(guard.begin("service-a", outcome("a-1"))).rejects.toThrow("disk unavailable");
      memory.conversation.mockResolvedValueOnce(null as never);
      await expect(guard.begin("service-a", outcome("a-1"))).rejects.toThrow("所属会话不可用");
    });
  });
});
