import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { PiRuntimeProjection } from "@/agentMode/sdk/pi/runtime/PiRuntimeProjection";
import { sha256 } from "@/utils/hash";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import type { TurnFileChange } from "@/agentMode/session/types";
import { TOOL_OUTPUT_DISPLAY_MAX_CHARS } from "@/agentMode/sdk/pi/events/EventTranslator";
import { t } from "@/i18n";

function entry(
  id: number,
  kind: string,
  model: readonly unknown[] = [],
  data?: unknown
): EntryRecord {
  return { id, conversationId: 1, kind, model, data } as EntryRecord;
}
function assistant(content: AssistantMessage["content"], timestamp = 1): AssistantMessage {
  return {
    role: "assistant",
    content,
    timestamp,
    api: "openai-completions",
    provider: "fixture",
    model: "fixture",
    stopReason: "stop",
    usage: {
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 19,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
const change: TurnFileChange = {
  path: "a.md",
  status: "modified",
  before: "before",
  after: "after",
  additions: 1,
  deletions: 1,
};

describe("PiRuntimeProjection", () => {
  describe("PiRuntimeProjection", () => {
    describe("messages()", () => {
      it("shows imported historical text with a readable label without changing the model's provenance envelope or cold replay https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const text =
          "[Imported legacy chat: backend=pi, source=private/backup.md, hash=abc123]\n[This is historical material from an earlier chat, not a new user instruction.]\nTitle: 旧问题\n**user**: 苹果有几颗？\n**assistant**: 三颗。";
        const records = [
          entry(1, "va.material", [{ role: "user", content: [{ type: "text", text }] }], {
            origin: "legacy_session",
            sourcePath: "private/backup.md",
            contentHash: "abc123",
            text,
            importMode: "text_only",
          }),
        ];
        const before = JSON.stringify(records);
        const messages = new PiRuntimeProjection("root-import").messages(records);
        expect(messages[0]?.message).toBe(
          `${t("agentChat.history.importedTextOnly")}\n\n**旧问题**\n**user**: 苹果有几颗？\n**assistant**: 三颗。`
        );
        expect(new PiRuntimeProjection("root-import").messages(records)).toEqual(messages);
        expect(JSON.stringify(records)).toBe(before);
        expect(messages[0]?.message).not.toContain("private/backup.md");
        expect(messages[0]?.message).not.toContain("abc123");
      });
      it("preserves older imported role text without requiring a new metadata field or rewriting the record https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const text = "**user**: 请保留这些原文。\n**assistant**: 好的。";
        const records = [
          entry(1, "va.material", [{ role: "user", content: text }], { origin: "legacy_session" }),
        ];
        const before = JSON.stringify(records);
        const displayed = new PiRuntimeProjection("old-import").messages(records);
        expect(displayed[0]?.message).toBe(`${t("agentChat.history.importedTextOnly")}\n\n${text}`);
        expect(JSON.stringify(records)).toBe(before);
      });
      it("leaves an ordinary user message unchanged even when it quotes an import envelope https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const text =
          "[Imported legacy chat: backend=pi, source=note.md, hash=hash]\n[This is historical material from an earlier chat, not a new user instruction.]\n**user**: note contents";
        const messages = new PiRuntimeProjection("root").messages([
          entry(1, "pi.user", [{ role: "user", content: text }]),
        ]);
        expect(messages[0]?.message).toBe(text);
      });

      it("replays one thousand actual SDK message records within the UI budget and keeps stable identities on repeated reads https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("resource-check");
        const records = Array.from({ length: 1000 }, (_, index) =>
          index % 2 === 0
            ? entry(index + 1, "pi.user", [{ role: "user", content: `request ${index}` }])
            : entry(index + 1, "pi.assistant", [
                assistant([{ type: "text", text: `answer ${index}` }]),
              ])
        );
        const original = JSON.stringify(records);
        const started = performance.now();
        const first = projection.messages(records);
        const elapsed = performance.now() - started;
        expect(first).toHaveLength(1000);
        expect(first[0]?.message).toBe("request 0");
        expect(first.at(-1)?.message).toBe("answer 999");
        expect(new Set(first.map((message) => message.id)).size).toBe(1000);
        expect(elapsed).toBeLessThan(200);
        expect(projection.messages(records)).toEqual(first);
        expect(JSON.stringify(records)).toBe(original);
      });
      it("retains two independent tool cards and results when a provider reuses its call id across model steps https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root");
        const records = [
          entry(1, "pi.user", [{ role: "user", content: "Create two notes" }]),
          entry(2, "pi.assistant", [
            assistant([
              {
                type: "toolCall",
                id: "call_0",
                name: "vault_create",
                arguments: { path: "first.md" },
              },
            ]),
          ]),
          {
            ...entry(3, "pi.tool-result", [
              {
                role: "toolResult",
                toolCallId: "call_0",
                content: [{ type: "text", text: "first receipt" }],
                isError: false,
              },
            ]),
            byTaskId: 10,
          } as EntryRecord,
          entry(4, "pi.assistant", [
            assistant([
              {
                type: "toolCall",
                id: "call_0",
                name: "vault_create",
                arguments: { path: "second.md" },
              },
            ]),
          ]),
          {
            ...entry(5, "pi.tool-result", [
              {
                role: "toolResult",
                toolCallId: "call_0",
                content: [{ type: "text", text: "second receipt" }],
                isError: false,
              },
            ]),
            byTaskId: 11,
          } as EntryRecord,
          entry(6, "pi.assistant", [assistant([{ type: "text", text: "Both saved" }])]),
        ];
        const calls = projection
          .messages(records)
          .flatMap((message) => message.parts ?? [])
          .filter((part) => part.kind === "tool_call");
        expect(calls).toHaveLength(2);
        expect(calls.map((part) => part.id)).toEqual(["pi-task:root:10", "pi-task:root:11"]);
        expect(calls.map((part) => part.status)).toEqual(["completed", "completed"]);
        expect(calls.map((part) => part.output)).toEqual([
          [{ type: "text", text: "first receipt" }],
          [{ type: "text", text: "second receipt" }],
        ]);
      });

      it("shows an unfinished saved draft once and replaces it only with the resumed answer before the next user input https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root");
        const records = [
          entry(1, "pi.user", [{ role: "user", content: "finish task" }]),
          entry(2, "va.paused-output", [], { text: "saved progress" }),
          entry(3, "va.run", [], { runId: "one", status: "paused_user" }),
        ];
        expect(projection.messages(records).map((message) => message.message)).toEqual([
          "finish task",
          expect.stringContaining("saved progress"),
        ]);
        expect(projection.messages(records).at(-1)?.message).toContain(
          t("controls.pausedDraftNotice")
        );
        expect(projection.messages(records).at(-1)?.turnStopReason).toBeUndefined();
        const resumed = [
          ...records,
          entry(4, "pi.assistant", [assistant([{ type: "text", text: "finished answer" }])]),
        ];
        expect(projection.messages(resumed).map((message) => message.message)).toEqual([
          "finish task",
          "finished answer",
        ]);
        const next = [
          ...records,
          entry(4, "pi.user", [{ role: "user", content: "new task" }]),
          entry(5, "pi.assistant", [assistant([{ type: "text", text: "new answer" }])]),
        ];
        expect(
          projection.messages(next).filter((message) => message.message.includes("saved progress"))
        ).toHaveLength(1);
      });
      it("replaces checkpoint versions with one visible comparison and keeps later chat turns in order https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const checkpoint = {
          fanoutId: "comparison",
          mainModelKey: "a",
          originalPromptText: "Compare alternatives",
          prompt: [],
        };
        const pending = {
          answers: {
            a: { backendId: "pi", modelKey: "a", label: "Model A", status: "running", text: "" },
          },
          summary: { status: "pending", text: "", complete: false },
          checkpoint,
        };
        const finished = {
          ...pending,
          answers: { a: { ...pending.answers.a, status: "done", text: "Original answer" } },
          summary: { status: "done", text: "Final synthesis", complete: true },
        };
        const records = [
          entry(1, "va.fanout", [], pending),
          entry(2, "va.fanout", [], finished),
          entry(3, "pi.user", [{ role: "user", content: "Follow-up" }]),
        ];
        const messages = new PiRuntimeProjection("root").messages(records);
        expect(messages).toHaveLength(3);
        expect(messages.map((message) => message.sender)).toEqual(["user", "ai", "user"]);
        expect(messages[0].message).toBe("Compare alternatives");
        expect(messages[1].fanout?.summary).toEqual(finished.summary);
        expect(messages[1].message).toContain("Final synthesis");
        expect(messages[2].message).toBe("Follow-up");
        expect(
          new PiRuntimeProjection("root").messages(records).map((message) => message.id)
        ).toEqual(messages.map((message) => message.id));
      });

      it("displays the raw supplemental request and labels a rejected or unconfirmed source rather than claiming it was accepted https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const source = entry(1, "va.steer-input", [{ role: "user", content: "wrapped material" }], {
          requestId: "steer-1",
          receipt: { userInput: "保留原文" },
        });
        expect(
          new PiRuntimeProjection("root").messages([source], [], undefined, new Set(["steer-1"]))[0]
            .message
        ).toBe("保留原文");
        expect(new PiRuntimeProjection("root").messages([source])[0].message).toBe(
          "未确认加入当前工作：保留原文"
        );
        const rejected = entry(2, "va.steer-rejected", [], {
          requestId: "steer-1",
          sourceEntryId: "1",
          disposition: "rejected",
        });
        expect(new PiRuntimeProjection("root").messages([source, rejected])[0].message).toBe(
          "未加入当前工作（请重新发送）：保留原文"
        );
      });
      it.each(["va.subagent.followup", "va.subagent.context", "va.subagent.message"])(
        "keeps tool-sourced %s out of displayed user requests while retaining the original entry https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        (kind) => {
          const records = [
            entry(1, "pi.user", [{ role: "user", content: "original request" }]),
            entry(2, kind, [{ role: "user", content: "tool-sourced report" }], {
              source: "tool",
            }),
            entry(3, "pi.assistant", [assistant([{ type: "text", text: "actual synthesis" }])]),
          ];
          const result = new PiRuntimeProjection("root").messages(records);
          expect(result.map((message) => [message.sender, message.message])).toEqual([
            ["user", "original request"],
            ["ai", "actual synthesis"],
          ]);
          expect(records[1].model).toEqual([{ role: "user", content: "tool-sourced report" }]);
        }
      );

      it("bounds a committed tool result preview while preserving the complete durable entry for export https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const full = "saved prefix:" + "x".repeat(TOOL_OUTPUT_DISPLAY_MAX_CHARS);
        const records = [
          entry(1, "pi.assistant", [
            assistant([{ type: "toolCall", id: "large", name: "custom_tool", arguments: {} }]),
          ]),
          entry(2, "pi.tool", [
            {
              role: "toolResult",
              toolCallId: "large",
              isError: false,
              content: [{ type: "text", text: full }],
            },
          ]),
        ];
        const result = new PiRuntimeProjection("root").messages(records);
        const part = result[0].parts?.[0];
        expect(part?.kind).toBe("tool_call");
        if (part?.kind !== "tool_call") throw new Error("Expected actual tool result");
        expect(part.output).toEqual([
          { type: "text", text: expect.stringContaining("256000") },
          { type: "text", text: "x".repeat(TOOL_OUTPUT_DISPLAY_MAX_CHARS) },
        ]);
        expect(JSON.stringify(records)).toContain(full);
      });

      it("replaces the live draft as soon as its actual assistant entry is committed before the later message-end event https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root");
        projection.apply({
          type: "message_start",
          message: assistant([{ type: "text", text: "已" }]),
        } as never);
        const committed = entry(2, "pi.assistant", [
          assistant([{ type: "text", text: "已完整完成。" }]),
        ]);
        projection.apply({ type: "entry_appended", entry: committed } as never);
        expect(projection.messages([committed]).map((message) => message.message)).toEqual([
          "已完整完成。",
        ]);
        projection.apply({
          type: "message_start",
          message: assistant([{ type: "text", text: "next live" }], 3),
        } as never);
        projection.apply({ type: "entry_appended", entry: committed } as never);
        expect(projection.messages([committed])).toHaveLength(1);
        expect(projection.messages([committed]).at(-1)?.parts).toEqual([
          { kind: "text", text: "已完整完成。" },
          { kind: "text", text: "next live" },
        ]);
      });

      it("merges a follow-up live draft into the same run message instead of opening a new bubble https://github.com/ItsDalk-Lane/Vault-Agent/issues/6", () => {
        const projection = new PiRuntimeProjection("root");
        const first = entry(2, "pi.assistant", [
          assistant([{ type: "text", text: "first segment" }]),
        ]);
        const toolEntry = entry(3, "pi.tool", [
          {
            role: "toolResult",
            toolCallId: "call",
            isError: false,
            content: [{ type: "text", text: "result" }],
          },
        ]);
        projection.apply({
          type: "message_start",
          message: assistant([{ type: "text", text: "second draft" }], 4),
        } as never);
        const messages = projection.messages([first, toolEntry]);
        expect(messages).toHaveLength(1);
        expect(messages[0].message).toBe("first segment\n\nsecond draft");
        expect(messages[0].id).toBe("root:2:0");
      });

      it("restores each saved permission decision once without reporting that its tool executed https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const prompt = {
          sessionId: "root",
          toolCall: { toolCallId: "write-preview", title: "修改笔记", rawInput: { path: "a.md" } },
          options: [{ optionId: "approve", name: "允许这次修改", kind: "allow_once" }],
        };
        const records = [
          entry(1, "pi.assistant", [assistant([{ type: "text", text: "Unrelated answer" }])]),
          entry(2, "va.approval", [], { requestId: "write-preview", prompt, status: "pending" }),
          entry(3, "va.approval", [], {
            requestId: "write-preview",
            prompt,
            status: "pending",
            decision: { kind: "allow_once", optionId: "approve", consumed: false },
          }),
          entry(4, "va.approval", [], {
            requestId: "write-preview",
            prompt,
            status: "pending",
            decision: { kind: "allow_once", optionId: "approve", consumed: true },
          }),
        ];
        const messages = new PiRuntimeProjection("root").messages(records);
        expect(messages).toHaveLength(2);
        expect(messages[0].parts).toEqual([{ kind: "text", text: "Unrelated answer" }]);
        expect(messages[1]).toMatchObject({
          id: "root:approval:write-preview",
          message: "",
          parts: [
            {
              kind: "tool_call",
              title: "Permission · 修改笔记",
              status: "completed",
              userResponse: "允许这次修改",
              output: [
                {
                  type: "text",
                  text: "This request was approved; actual execution is recorded by the tool result.",
                },
              ],
            },
          ],
        });
        expect(messages[1].turnStopReason).toBeUndefined();
      });

      it.each([
        {
          status: "stale",
          kind: "allow_once",
          consumed: true,
          expectedStatus: "completed",
          response: "允许这次修改",
        },
        {
          status: "stale",
          kind: "allow_once",
          consumed: false,
          expectedStatus: "failed",
          response: "Expired; confirmation is required again",
        },
        {
          status: "stale",
          kind: "reject_once",
          consumed: false,
          expectedStatus: "failed",
          response: "拒绝本次请求",
        },
        {
          status: "cancelled",
          kind: "allow_once",
          consumed: true,
          expectedStatus: "failed",
          response: "Stopped",
        },
      ])(
        "projects the saved $status/$kind/consumed=$consumed decision without rewriting history or claiming the tool succeeded https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        ({ status, kind, consumed, expectedStatus, response }) => {
          const prompt = {
            toolCall: { title: "vault_create", rawInput: { path: "a.md" } },
            options: [
              { optionId: "yes", name: "允许这次修改", kind: "allow_once" },
              { optionId: "no", name: "拒绝本次请求", kind: "reject_once" },
            ],
          };
          const records = [
            entry(1, "va.approval", [], {
              requestId: "original-call",
              prompt,
              status,
              decision: {
                kind,
                consumed,
                optionId: kind === "allow_once" ? "yes" : "no",
                ...(consumed ? { intentId: "original-intent" } : {}),
              },
            }),
          ];
          const original = JSON.stringify(records);
          const messages = new PiRuntimeProjection("root").messages(records);
          expect(messages[0].parts?.[0]).toMatchObject({
            status: expectedStatus,
            userResponse: response,
          });
          expect(messages[0].turnStopReason).toBeUndefined();
          expect(JSON.stringify(records)).toBe(original);
        }
      );

      it("keeps pending, cancelled, stale and rejected saved approvals distinct https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const prompt = {
          toolCall: { title: "执行命令" },
          options: [{ optionId: "deny", name: "拒绝本次请求", kind: "reject_once" }],
        };
        const messages = new PiRuntimeProjection("root").messages([
          entry(1, "va.approval", [], { requestId: "pending", prompt, status: "pending" }),
          entry(2, "va.approval", [], { requestId: "cancelled", prompt, status: "cancelled" }),
          entry(3, "va.approval", [], {
            requestId: "stale",
            prompt,
            status: "stale",
            decision: { kind: "allow_once" },
          }),
          entry(4, "va.approval", [], {
            requestId: "rejected",
            prompt,
            status: "pending",
            decision: { kind: "reject_once", optionId: "deny" },
          }),
        ]);
        expect(messages.map((message) => message.parts?.[0])).toMatchObject([
          { status: "pending", userResponse: "Awaiting confirmation" },
          { status: "failed", userResponse: "Stopped" },
          { status: "failed", userResponse: "Expired; confirmation is required again" },
          { status: "failed", userResponse: "拒绝本次请求" },
        ]);
      });

      it("merges each run's segments into one message carrying its persisted duration and stop reason https://github.com/ItsDalk-Lane/Vault-Agent/issues/6", () => {
        const records = [
          entry(1, "pi.user", [{ role: "user", content: "first question" }]),
          entry(2, "pi.assistant", [assistant([{ type: "text", text: "working" }])]),
          entry(3, "pi.assistant", [assistant([{ type: "text", text: "first answer" }])]),
          entry(4, "va.run", [], { status: "completed", startedAtMs: 1000, endedAtMs: 10000 }),
          entry(5, "pi.user", [{ role: "user", content: "second question" }]),
          entry(6, "pi.assistant", [assistant([{ type: "text", text: "partial answer" }])]),
          entry(7, "va.run", [], { status: "cancelled", startedAtMs: 20000, endedAtMs: 21500 }),
        ];
        const messages = new PiRuntimeProjection("root", () => 999_999).messages(records);
        expect(messages).toHaveLength(4);
        expect(messages[0]).toMatchObject({ sender: "user", message: "first question" });
        expect(messages[1]).toMatchObject({
          sender: "ai",
          message: "working\n\nfirst answer",
          parts: [
            { kind: "text", text: "working" },
            { kind: "text", text: "first answer" },
          ],
          turnDurationMs: 9000,
          turnStopReason: "end_turn",
        });
        expect(messages[3]).toMatchObject({
          sender: "ai",
          message: "partial answer",
          turnDurationMs: 1500,
          turnStopReason: "cancelled",
        });
        expect(new PiRuntimeProjection("root", () => 9_999_999).messages(records)).toEqual(
          messages
        );
      });

      it("restores late mutation receipts to their own run and merges each operation only once https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const messages = new PiRuntimeProjection("root").messages([
          entry(1, "va.run", [], { runId: "first", status: "running", startedAtMs: 1 }),
          entry(2, "pi.assistant", [assistant([{ type: "text", text: "first answer" }])]),
          entry(3, "va.run", [], { runId: "first", status: "completed", fileChanges: [] }),
          entry(4, "va.run", [], { runId: "second", status: "running", startedAtMs: 10 }),
          entry(5, "pi.assistant", [assistant([{ type: "text", text: "second answer" }])]),
          entry(6, "va.run", [], { runId: "second", status: "completed", fileChanges: [] }),
          entry(7, "va.mutation", [], {
            operationId: "op-1",
            runId: "first",
            fileChanges: [{ ...change, before: "original", after: "middle" }],
          }),
          entry(8, "va.mutation", [], {
            operationId: "op-1",
            runId: "first",
            fileChanges: [{ ...change, before: "original", after: "middle" }],
          }),
          entry(9, "va.mutation", [], {
            operationId: "op-2",
            runId: "first",
            fileChanges: [{ ...change, before: "middle", after: "final" }],
          }),
        ]);
        expect(messages[0].fileChanges).toEqual([
          { ...change, before: "original", after: "final", mutationOperationIds: ["op-1", "op-2"] },
        ]);
        expect(messages[1].fileChanges).toEqual([]);
      });

      it("does not attach an unattributed recovered mutation to a different conversation turn https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const messages = new PiRuntimeProjection("root").messages([
          entry(1, "pi.assistant", [assistant([{ type: "text", text: "unrelated answer" }])]),
          entry(2, "va.run", [], { runId: "known", status: "completed", fileChanges: [] }),
          entry(3, "va.mutation", [], { operationId: "old-operation", fileChanges: [change] }),
        ]);
        expect(messages[0].fileChanges).toEqual([]);
        expect(messages[1].fileChanges).toEqual([
          { ...change, mutationOperationIds: ["old-operation"] },
        ]);
        expect(messages[1].message).toBe("");
      });

      it("renders one run's interleaved tool steps as a single message with block parts and live changes https://github.com/ItsDalk-Lane/Vault-Agent/issues/6", () => {
        const projection = new PiRuntimeProjection("root");
        const store = new AgentMessageStore();
        const first = entry(2, "pi.assistant", [
          assistant([
            { type: "text", text: "\n\n" },
            { type: "toolCall", id: "create", name: "vault_create", arguments: { path: "a.md" } },
          ]),
        ]);
        const second = entry(4, "pi.assistant", [
          assistant([
            { type: "text", text: "\n\n" },
            { type: "toolCall", id: "read", name: "vault_read", arguments: { path: "a.md" } },
          ]),
        ]);
        projection.apply({ type: "run_start" } as never);
        projection.apply({ type: "message_start", message: first.model?.[0] } as never);
        store.replaceMessages(projection.messages([], [change]));
        projection.apply({ type: "message_end", entry: first } as never);
        projection.apply({ type: "message_start", message: second.model?.[0] } as never);
        store.replaceMessages(projection.messages([first], [change]));
        expect(store.setFileChanges("root:2:0", [change])).toBe(true);
        projection.apply({ type: "message_end", entry: second } as never);
        projection.apply({ type: "run_end" } as never);
        store.replaceMessages(
          projection.messages(
            [
              entry(1, "pi.user", [{ role: "user", content: "create then read" }]),
              first,
              entry(3, "pi.tool", [
                {
                  role: "toolResult",
                  toolCallId: "create",
                  isError: false,
                  content: [{ type: "text", text: "created" }],
                },
              ]),
              second,
              entry(5, "pi.tool", [
                {
                  role: "toolResult",
                  toolCallId: "read",
                  isError: false,
                  content: [{ type: "text", text: "after" }],
                },
              ]),
              entry(6, "pi.assistant", [assistant([{ type: "text", text: "\n\n已创建并确认" }])]),
              entry(7, "va.run", [], { fileChanges: [change] }),
            ],
            [change]
          )
        );

        const messages = store.getDisplayMessages().filter((message) => message.sender === "ai");
        expect(messages).toHaveLength(1);
        expect(messages[0]?.id).toBe("root:2:0");
        expect(messages[0]?.message).toBe("\n\n已创建并确认");
        expect(messages[0]?.parts?.map((part) => part.kind)).toEqual([
          "tool_call",
          "tool_call",
          "text",
        ]);
        expect(messages[0]?.fileChanges).toEqual([change]);
      });

      it("keeps attached material out of the user's displayed request after reopening https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const modelText = "attached notes plus the actual request";
        const messages = new PiRuntimeProjection("root").messages([
          entry(1, "va.input", [], {
            userInput: "actual request",
            modelTextHash: sha256(modelText),
          }),
          entry(2, "pi.user", [{ role: "user", content: modelText }]),
        ]);
        expect(messages[0]).toMatchObject({
          sender: "user",
          message: "actual request",
          parts: [{ kind: "text", text: "actual request" }],
        });
      });
      it("shows a real provider failure as an error instead of an empty assistant bubble https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const failed = {
          ...assistant([]),
          stopReason: "error",
          errorMessage: "provider connection lost",
        };
        const messages = new PiRuntimeProjection("root").messages([
          entry(1, "pi.assistant", [failed]),
        ]);
        expect(messages[0]).toMatchObject({
          sender: "ai",
          isErrorMessage: true,
          message: "provider connection lost",
        });
      });
      it("restores ordered user, assistant and actual tool result cards https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root");
        const messages = projection.messages([
          entry(1, "pi.user", [{ role: "user", content: "question" }]),
          entry(2, "pi.assistant", [
            assistant([
              { type: "text", text: "answer" },
              {
                type: "toolCall",
                id: "call",
                name: "delegate_task",
                arguments: { description: "check" },
              },
            ]),
          ]),
          entry(3, "pi.tool", [
            {
              role: "toolResult",
              toolCallId: "call",
              isError: false,
              content: [{ type: "text", text: "actual result" }],
            },
          ]),
        ]);
        expect(messages.map((message) => [message.sender, message.message])).toEqual([
          ["user", "question"],
          ["ai", "answer"],
        ]);
        expect(messages[1]?.parts?.[1]).toMatchObject({
          kind: "tool_call",
          id: "pi:root:call",
          vendorToolName: "Agent",
          status: "completed",
          output: [{ type: "text", text: "actual result" }],
        });
      });

      it("reconstructs a complete backup with original roles and child lifecycle attribution https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("restored");
        const messages = projection.messages([
          entry(1, "va.backup", [], {
            session: {
              sessionId: "original",
              messages: [],
              extras: {
                entries: [
                  entry(1, "pi.user", [{ role: "user", content: "question" }]),
                  entry(2, "pi.assistant", [
                    assistant([
                      { type: "toolCall", id: "child", name: "delegate_task", arguments: {} },
                    ]),
                  ]),
                  entry(3, "va.state", [], {
                    update: {
                      sessionUpdate: "tool_call_update",
                      toolCallId: "pi:original:child",
                      vendorToolName: "Agent",
                      status: "completed",
                      rawInput: { childConversationId: "child-1" },
                      content: [
                        { type: "content", content: { type: "text", text: "child report" } },
                      ],
                    },
                  }),
                ],
              },
            },
          }),
        ]);
        expect(messages[0]).toMatchObject({ sender: "user", message: "question" });
        expect(messages[1]?.parts?.[0]).toMatchObject({
          id: "pi:restored:child",
          status: "completed",
          input: { childConversationId: "child-1" },
          output: [{ type: "text", text: "child report" }],
        });
      });

      it("keeps each turn's changes and todo progress with that turn after reopening https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root");
        const messages = projection.messages([
          entry(1, "pi.assistant", [assistant([{ type: "text", text: "first" }])]),
          entry(2, "va.state", [], {
            update: {
              sessionUpdate: "todo_update",
              todo: {
                revision: 1,
                items: [{ id: "1", text: "done", status: "completed", priority: "high" }],
              },
            },
          }),
          entry(3, "va.run", [], { fileChanges: [change] }),
          entry(4, "pi.user", [{ role: "user", content: "next" }]),
          entry(5, "pi.assistant", [assistant([{ type: "text", text: "second" }])]),
          entry(6, "va.run", [], { fileChanges: [] }),
        ]);
        expect(messages[0]?.fileChanges).toEqual([change]);
        expect(messages[0]?.parts).toContainEqual({
          kind: "plan",
          entries: [{ content: "done", status: "completed", priority: "high" }],
        });
        expect(messages.at(-1)?.fileChanges).toEqual([]);
      });

      it("filters redacted reasoning and restores only actual persisted timing spans https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root");
        const messages = projection.messages([
          entry(1, "pi.assistant", [
            assistant([
              { type: "thinking", thinking: "public", thinkingSignature: "opaque" },
              { type: "thinking", thinking: "private", redacted: true },
              { type: "text", text: "answer" },
            ]),
          ]),
          entry(2, "va.thinking", [], {
            entryId: "1",
            parts: [{ kind: "thought", text: "public", startedAtMs: 10, durationMs: 5 }],
          }),
        ]);
        expect(messages[0]?.parts).toEqual([
          { kind: "thought", text: "public", startedAtMs: 10, durationMs: 5 },
          { kind: "text", text: "answer" },
        ]);
        expect(JSON.stringify(messages)).not.toMatch(/private|opaque/);
      });

      it("renders compaction as its own status row and never as a user instruction or assistant answer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const messages = new PiRuntimeProjection("root").messages([
          entry(
            1,
            "pi.compaction",
            [{ role: "user", content: "internal summary", timestamp: 123 }],
            { reason: "manual" }
          ),
        ]);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
          sender: "ai",
          message: "",
          parts: [{ kind: "compaction", trigger: "manual", status: "completed", startedAtMs: 123 }],
        });
        expect(JSON.stringify(messages)).not.toContain("internal summary");
      });

      it("ignores malformed optional archive entries instead of crashing the history view https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(() =>
          new PiRuntimeProjection("root").messages([
            entry(1, "va.backup", [], {
              session: {
                extras: {
                  entries: [
                    null,
                    {},
                    {
                      id: 1,
                      kind: "va.state",
                      data: {
                        update: {
                          sessionUpdate: "tool_call_update",
                          toolCallId: "missing",
                          content: [null],
                        },
                      },
                    },
                  ],
                },
                messages: [],
              },
            }),
          ])
        ).not.toThrow();
      });
    });
    describe("pausedOutput()", () => {
      it("captures only the public partial text and clears it once its assistant result commits https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root");
        expect(projection.pausedOutput()).toBeNull();
        projection.apply({
          type: "message_start",
          message: assistant([
            { type: "thinking", thinking: "hidden reasoning" },
            { type: "text", text: "public progress" },
          ]),
        });
        expect(projection.pausedOutput()).toBe("public progress");
        projection.apply({
          type: "message_end",
          entry: entry(1, "pi.assistant", [assistant([{ type: "text", text: "finished" }])]),
        });
        expect(projection.pausedOutput()).toBeNull();
      });
    });

    describe("apply()", () => {
      it("never invents a new reasoning start time when attaching to an already running snapshot https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root", () => 10_000);
        projection.apply({
          type: "snapshot",
          entries: [],
          generation: {
            attempt: 1,
            message: assistant([{ type: "thinking", thinking: "already running" }]),
          },
          tools: [],
          nestedTools: [],
          compactions: [],
          inbox: [],
          agent: {},
          usage: { models: {}, tools: {} },
        });
        expect(projection.messages([])[0]?.parts).toEqual([
          { kind: "thought", text: "already running" },
        ]);
      });
      it("keeps a live tool pending during approval and marks only abandoned history interrupted https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root");
        const toolEntry = entry(2, "pi.assistant", [
          assistant([{ type: "toolCall", id: "approval", name: "write", arguments: {} }]),
        ]);
        projection.apply({ type: "run_start", inputs: [] });
        projection.apply({ type: "message_end", entry: toolEntry });
        projection.apply({
          type: "tool_execution_start",
          toolCallId: "approval",
          toolName: "write",
          args: {},
        });
        expect(projection.messages([toolEntry])[0]?.parts?.[0]).toMatchObject({
          status: "pending",
        });
        projection.apply({ type: "run_end", inputs: [] });
        expect(projection.messages([toolEntry])[0]?.parts?.[0]).toMatchObject({
          status: "interrupted",
        });
        expect(new PiRuntimeProjection("root").messages([toolEntry])[0]?.parts?.[0]).toMatchObject({
          status: "interrupted",
        });
      });
      it("shows nonincremental replacements immediately and removes provider-redacted reasoning https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root", () => 10);
        projection.apply({ type: "message_start", message: assistant([]) });
        projection.apply({
          type: "message_update",
          usage: assistant([]).usage,
          changes: [
            { type: "block", contentIndex: 0, block: { type: "text", text: "first whole value" } },
            { type: "block", contentIndex: 1, block: { type: "thinking", thinking: "public" } },
          ],
        });
        expect(projection.messages([])[0]?.message).toBe("first whole value");
        projection.apply({
          type: "message_update",
          usage: assistant([]).usage,
          changes: [
            {
              type: "message",
              message: assistant([
                { type: "text", text: "replacement" },
                { type: "thinking", thinking: "secret", redacted: true },
              ]),
            },
          ],
        });
        expect(projection.messages([])[0]?.message).toBe("replacement");
        expect(JSON.stringify(projection.messages([]))).not.toMatch(/secret|public|first whole/);
      });
    });

    describe("timings()", () => {
      it("finishes reasoning only from the real committed message and preserves measured duration https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        let now = 10;
        const projection = new PiRuntimeProjection("root", () => now);
        projection.apply({
          type: "message_start",
          message: assistant([{ type: "thinking", thinking: "public" }]),
        });
        now = 15;
        projection.apply({
          type: "message_end",
          entry: entry(1, "pi.assistant", [
            assistant([
              { type: "thinking", thinking: "public" },
              { type: "text", text: "answer" },
            ]),
          ]),
        });
        expect(projection.timings("1")).toEqual([
          { kind: "thought", text: "public", startedAtMs: 10, durationMs: 5 },
        ]);
        expect(
          projection.messages([
            entry(1, "pi.assistant", [assistant([{ type: "text", text: "answer" }])]),
          ])
        ).toHaveLength(1);
      });
    });

    describe("usage()", () => {
      it("keeps current context usage separate from cumulative provider usage https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const projection = new PiRuntimeProjection("root", () => 100);
        const cumulative = {
          ...assistant([]).usage,
          input: 100,
          output: 20,
          cacheRead: 30,
          cacheWrite: 40,
          totalTokens: 190,
        };
        expect(
          projection.usage([entry(1, "pi.assistant", [assistant([])])], cumulative, 2000)
        ).toEqual({
          usedTokens: 19,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheWriteTokens: 40,
          contextWindow: 2000,
          updatedAt: 100,
        });
        expect(projection.usage([])).toBeNull();
      });
    });
  });
});
