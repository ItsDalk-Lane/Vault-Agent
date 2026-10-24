import type { EntryRecord, TaskRecord, Harness } from "@earendil-works/pi-durable";
import { deriveSdkToolRejection, readSdkToolRejections } from "./SdkToolRejections";

jest.mock("@earendil-works/chord/context", () => ({ BACKGROUND_CONTEXT: {} }), { virtual: true });

function fixture(code = "invalid_arguments", taskId = 7) {
  const entry = {
    id: 11,
    conversationId: 1,
    byTaskId: taskId,
    kind: "pi.tool-result",
    data: { diagnostics: [{ severity: "error", code, message: "Schema rejected" }] },
    model: [
      {
        role: "toolResult",
        toolCallId: "reused",
        toolName: "inspect",
        content: [],
        isError: true,
        timestamp: 1,
      },
    ],
  } as unknown as EntryRecord;
  const task = {
    id: taskId,
    kind: "pi.tool",
    conversationId: 1,
    input: { kind: "model", assistant: 3, callId: "reused" },
    state: {
      status: "terminal",
      outcome: { status: "completed", result: { kind: "model", entryId: 11 } },
    },
  } as unknown as TaskRecord<unknown, unknown, unknown>;
  return { entry, task };
}

describe("SdkToolRejections", () => {
  describe("readSdkToolRejections()", () => {
    it("restores only committed task-attributed rejections and never uses provider call IDs to find a task https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const source = fixture();
      const getTask = jest.fn(async (_taskId: unknown) => source.task);
      const facts = await readSdkToolRejections({
        harness: { getTask } as unknown as Pick<Harness, "getTask">,
        entries: [
          { ...source.entry, kind: "pi.assistant" },
          { ...source.entry, byTaskId: undefined },
          source.entry,
        ],
        ownerSessionId: "root",
        caller: () => "root",
      });
      expect(facts.map((fact) => fact.taskId)).toEqual(["7"]);
      expect(getTask).toHaveBeenCalledTimes(1);
      expect(getTask.mock.calls[0][0]).toBe(7);
    });
  });
  describe("deriveSdkToolRejection()", () => {
    it.each(["invalid_arguments", "tool_unavailable"])(
      "derives %s from the actual committed task and entry without executing or rewriting source records https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      (code) => {
        const source = fixture(code);
        const before = JSON.stringify(source);
        const result = deriveSdkToolRejection({
          ownerSessionId: "root",
          caller: "root",
          ...source,
        });
        expect(result?.outcome).toMatchObject({
          operationId: "tool-task:root:1:7",
          source: { toolId: "inspect", caller: "root" },
          status: "error",
          effect: "not_applied",
          error: { code, phase: "validation" },
          receipts: ["entry:11"],
          nextActions: ["revise_request"],
        });
        expect(JSON.stringify(source)).toBe(before);
        expect(
          deriveSdkToolRejection({ ownerSessionId: "root", caller: "root", ...fixture(code, 8) })
            ?.outcome.operationId
        ).not.toBe(result?.outcome.operationId);
      }
    );

    it("does not infer nonexecution from interrupted or mismatched tasks and never uses a repeated raw call identifier as identity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(
        deriveSdkToolRejection({
          ownerSessionId: "root",
          caller: "root",
          ...fixture("interrupted"),
        })
      ).toBeNull();
      const source = fixture();
      expect(
        deriveSdkToolRejection({
          ownerSessionId: "root",
          caller: "root",
          entry: source.entry,
          task: fixture("invalid_arguments", 8).task,
        })
      ).toBeNull();
    });

    it("derives nested validation failures only from the exact parent/key receipt and actual nested task https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const task = {
        id: 8,
        kind: "pi.tool",
        conversationId: 1,
        input: {
          kind: "nested",
          parent: 4,
          key: "nested-key",
          call: { id: "reused", name: "inspect", arguments: { path: 12 } },
        },
        state: { status: "terminal", outcome: { status: "completed", result: { kind: "nested" } } },
      } as unknown as TaskRecord<unknown, unknown, unknown>;
      const nested = {
        parentTaskId: "4",
        key: "nested-key",
        result: {
          taskId: 8,
          isError: true,
          diagnostics: [{ severity: "error", code: "invalid_arguments", message: "Bad path" }],
        },
      };
      expect(
        deriveSdkToolRejection({ ownerSessionId: "root", caller: "subagent", task, nested })
          ?.outcome
      ).toMatchObject({
        operationId: "tool-task:root:1:8",
        error: { phase: "validation" },
        receipts: ["nested:4:nested-key:8"],
      });
      expect(
        deriveSdkToolRejection({
          ownerSessionId: "root",
          caller: "subagent",
          task,
          nested: { ...nested, key: "different" },
        })
      ).toBeNull();
    });
  });
});
