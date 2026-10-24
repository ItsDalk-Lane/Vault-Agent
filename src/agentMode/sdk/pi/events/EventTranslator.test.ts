import type { AgentEvent, EntryRecord, MessageChange } from "@earendil-works/pi-durable";

import {
  EventTranslator,
  EventTranslatorError,
  type TranslatedEvent,
} from "@/agentMode/sdk/pi/events/EventTranslator";
import { namespacedToolCallId, toolKindFor } from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";
import { SessionExport } from "@/agentMode/sdk/pi/storage/SessionExport";

// The translator is the only producer for Durable agent events: exhaustive over the real
// AgentEvent union, contentIndex blocks distinguish append from replacement, tool ids are
// session-namespaced with their child ownership, and an end without a result is not success:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function createTranslator(
  options: {
    sessionId?: string;
    events?: TranslatedEvent[];
    mcpServerFor?: (toolName: string) => string | undefined;
  } = {}
): {
  translator: EventTranslator;
  events: TranslatedEvent[];
} {
  const events = options.events ?? [];
  const translator = new EventTranslator({
    sessionId: options.sessionId ?? "session-1",
    emit: (event) => events.push(event),
    now: () => 1_700_000_000_000,
    ...(options.mcpServerFor !== undefined ? { mcpServerFor: options.mcpServerFor } : {}),
  });
  return { translator, events };
}

function translate(translator: EventTranslator, event: unknown): void {
  translator.translate(event as AgentEvent);
}

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages" as const,
    provider: "provider-1",
    model: "model-1",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: 1,
  };
}

function messageUpdate(changes: MessageChange[]): AgentEvent {
  return {
    type: "message_update",
    usage: assistantMessage("").usage,
    changes,
  } as unknown as AgentEvent;
}

function toolStart(
  toolCallId: string,
  toolName: string,
  extra: { parentToolCallId?: string; parentTaskId?: string } = {}
): AgentEvent {
  return {
    type: "tool_execution_start",
    toolCallId,
    toolName,
    args: {},
    ...extra,
  } as unknown as AgentEvent;
}

describe("EventTranslator", () => {
  describe("durable tool identity", () => {
    it("keeps independent streamed lifecycles for repeated provider ids https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { translator, events } = createTranslator();
      for (const taskId of [10, 11]) {
        translator.translate({
          type: "tool_execution_start",
          toolCallId: "call_0",
          toolName: "vault_create",
          args: {},
          taskId,
        } as AgentEvent);
        translator.translate({
          type: "tool_execution_end",
          toolCallId: "call_0",
          toolName: "vault_create",
          taskId,
          result: {
            taskId,
            isError: false,
            diagnostics: [],
            output: [{ type: "text", text: "saved" }],
          },
        } as unknown as AgentEvent);
      }
      expect(
        events.filter((event) => event.kind === "tool_call_end").map((event) => event.toolCallId)
      ).toEqual(["pi-task:session-1:10", "pi-task:session-1:11"]);
    });
  });

  describe("message text", () => {
    it("appends text deltas and keeps each contentIndex block separate", () => {
      const { translator, events } = createTranslator();
      translate(
        translator,
        messageUpdate([
          { type: "text_start", contentIndex: 0, block: { type: "text", text: "" } },
          { type: "text_delta", contentIndex: 0, delta: "Hello" },
          { type: "text_delta", contentIndex: 0, delta: " world" },
        ])
      );

      expect(events).toEqual([
        { kind: "message_text", delta: "Hello" },
        { kind: "message_text", delta: " world" },
      ]);
      expect(translator.currentText()).toBe("Hello world");
    });

    it("replaces a text block instead of appending it again", () => {
      const { translator, events } = createTranslator();
      translate(
        translator,
        messageUpdate([
          { type: "text_start", contentIndex: 0, block: { type: "text", text: "" } },
          { type: "text_delta", contentIndex: 0, delta: "draft" },
          { type: "block", contentIndex: 0, block: { type: "text", text: "replacement" } },
        ])
      );

      expect(events).toEqual([
        { kind: "message_text", delta: "draft" },
        { kind: "message_text_replace", text: "replacement" },
      ]);
      expect(translator.currentText()).toBe("replacement");
    });

    it("replaces the whole message without duplicating earlier text", () => {
      const { translator, events } = createTranslator();
      translate(
        translator,
        messageUpdate([
          { type: "text_start", contentIndex: 0, block: { type: "text", text: "" } },
          { type: "text_delta", contentIndex: 0, delta: "hel" },
          { type: "message", message: assistantMessage("final answer") },
        ])
      );

      expect(events).toEqual([
        { kind: "message_text", delta: "hel" },
        { kind: "message_text_replace", text: "final answer" },
      ]);
      expect(translator.currentText()).toBe("final answer");
      expect(events.filter((event) => event.kind === "message_text")).toHaveLength(1);
    });

    it("tracks thinking blocks separately from text", () => {
      const { translator, events } = createTranslator();
      translate(
        translator,
        messageUpdate([
          { type: "thinking_start", contentIndex: 0, block: { type: "thinking", thinking: "" } },
          { type: "thinking_delta", contentIndex: 0, delta: "plan step" },
          { type: "text_start", contentIndex: 1, block: { type: "text", text: "" } },
          { type: "text_delta", contentIndex: 1, delta: "answer" },
        ])
      );

      expect(events).toEqual([
        { kind: "message_thinking", delta: "plan step" },
        { kind: "message_text", delta: "answer" },
      ]);
      expect(translator.currentThinking()).toBe("plan step");
      expect(translator.currentText()).toBe("answer");
    });
  });

  describe("tool calls", () => {
    it("namespaces one tool id per session so equal provider ids do not collide", () => {
      const first = createTranslator({ sessionId: "session-a" });
      const second = createTranslator({ sessionId: "session-b" });

      first.translator.translate(toolStart("call-1", "read"));
      second.translator.translate(toolStart("call-1", "read"));

      const firstSnapshot = first.events[0];
      const secondSnapshot = second.events[0];
      expect(firstSnapshot).toMatchObject({
        kind: "tool_call",
        tool: { toolCallId: "pi:session-a:call-1" },
      });
      expect(secondSnapshot).toMatchObject({
        kind: "tool_call",
        tool: { toolCallId: "pi:session-b:call-1" },
      });
      expect(firstSnapshot).not.toEqual(secondSnapshot);
    });

    it("keeps child ownership in the namespaced nested tool id and parent id", () => {
      const { translator, events } = createTranslator({ sessionId: "session-a" });
      translate(
        translator,
        toolStart("call-1/key", "bash", { parentToolCallId: "call-1", parentTaskId: "task-2" })
      );

      expect(events[0]).toMatchObject({
        kind: "tool_call",
        tool: {
          toolCallId: "pi:session-a:call-1/key",
          parentToolCallId: "pi-task:session-a:task-2",
        },
      });
      expect(namespacedToolCallId("session-a", "call-1")).toBe("pi:session-a:call-1");
    });

    it("accumulates partial tool arguments without claiming the tool started", () => {
      const { translator, events } = createTranslator();
      translate(
        translator,
        messageUpdate([
          {
            type: "toolcall_start",
            contentIndex: 0,
            block: { type: "toolCall", id: "call-2", name: "read", arguments: {} },
          },
          { type: "toolcall_delta", contentIndex: 0, path: ["path"], delta: '"notes/' },
          { type: "toolcall_delta", contentIndex: 0, path: ["path"], delta: 'a.md"' },
        ])
      );

      expect(events[0]).toMatchObject({ kind: "tool_call", tool: { status: "pending" } });
      expect(events.filter((event) => event.kind === "tool_call_update")).toEqual([
        {
          kind: "tool_call_update",
          delta: { toolCallId: "pi:session-1:call-2", rawInput: { path: "notes/a.md" } },
        },
      ]);
      expect(translator.toolStatus("pi:session-1:call-2")).toBe("pending");
    });

    it("moves a tool to in_progress only when real output arrives and patches trimmed output", () => {
      const { translator, events } = createTranslator();
      translate(translator, toolStart("call-3", "read"));
      translate(translator, {
        type: "tool_execution_update",
        toolCallId: "call-3",
        toolName: "read",
        output: { append: "first\nsecond\n" },
      });
      translate(translator, {
        type: "tool_execution_update",
        toolCallId: "call-3",
        toolName: "read",
        output: { trimStart: 6, append: "third\n" },
      });

      expect(translator.toolStatus("pi:session-1:call-3")).toBe("in_progress");
      const updates = events.filter((event) => event.kind === "tool_call_update");
      expect(updates[updates.length - 1]).toMatchObject({
        delta: {
          toolCallId: "pi:session-1:call-3",
          status: "in_progress",
          content: [{ type: "content", content: { type: "text", text: "second\nthird\n" } }],
        },
      });
    });

    it("bounds production SDK output updates and keeps trimStart aligned after a local tail was retained https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { translator, events } = createTranslator();
      const tail = () => {
        const update = events.filter((event) => event.kind === "tool_call_update").at(-1);
        if (update?.kind !== "tool_call_update") throw new Error("missing output update");
        const content = update.delta.content?.at(-1);
        if (content?.type !== "content" || content.content.type !== "text")
          throw new Error("missing textual output");
        return content.content.text;
      };
      translator.translate({
        type: "tool_execution_start",
        toolCallId: "bounded",
        toolName: "read",
        args: {},
      });
      let retained = `discarded:${"prefix".repeat(2500)}${"0123456789".repeat(25_600)}`;
      const first: AgentEvent = {
        type: "tool_execution_update",
        toolCallId: "bounded",
        toolName: "read",
        output: { append: retained },
      };
      translator.translate(first);
      expect(tail()).toBe(retained.slice(-256_000));
      expect(JSON.stringify(events.at(-1))).toContain("256000");
      for (const trim of [200, 20_000]) {
        retained = `${retained.slice(trim)}:next`;
        translator.translate({
          type: "tool_execution_update",
          toolCallId: "bounded",
          toolName: "read",
          output: { trimStart: trim, append: ":next" },
        });
        expect(tail()).toBe(retained.slice(-256_000));
        expect(tail().length).toBeLessThanOrEqual(256_000);
      }
      const replacement = `replacement:${"x".repeat(300_000)}`;
      translator.translate({
        type: "tool_execution_update",
        toolCallId: "bounded",
        toolName: "read",
        output: { set: replacement },
      });
      expect(tail()).toBe(replacement.slice(-256_000));
      expect(first.output).toEqual({
        append: `discarded:${"prefix".repeat(2500)}${"0123456789".repeat(25_600)}`,
      });
    });

    it("does not reopen a finished production tool when a late output update arrives https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { translator, events } = createTranslator();
      translate(translator, toolStart("ended", "read"));
      translator.translate({ type: "tool_execution_end", toolCallId: "ended", toolName: "read" });
      const count = events.length;
      translator.translate({
        type: "tool_execution_update",
        toolCallId: "ended",
        toolName: "read",
        output: { append: "late" },
      });
      expect(events).toHaveLength(count);
      expect(translator.toolStatus("pi:session-1:ended")).toBe("interrupted");
    });

    it("keeps the original long SDK result intact so a full backup still contains every saved character https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { translator } = createTranslator();
      const originalText = `complete-source:${"saved-output-".repeat(30_000)}`;
      const entry: EntryRecord = {
        id: 1 as EntryRecord["id"],
        conversationId: 1 as EntryRecord["conversationId"],
        kind: "pi.tool",
        model: [
          {
            role: "toolResult",
            toolCallId: "long",
            toolName: "read",
            content: [{ type: "text", text: originalText }],
            isError: false,
            timestamp: 1,
          },
        ],
      };
      const original = JSON.stringify(entry);
      translate(translator, toolStart("long", "read"));
      translator.translate({
        type: "tool_execution_update",
        toolCallId: "long",
        toolName: "read",
        output: { append: originalText },
      });
      translator.translate({
        type: "tool_execution_end",
        toolCallId: "long",
        toolName: "read",
        entry,
      });
      expect(JSON.stringify(entry)).toBe(original);
      const files = new Map<string, string>();
      const exporter = new SessionExport({
        ports: {
          writeFile: async (target, text) => {
            files.set(target, text);
          },
          readFile: async (target) => files.get(target) ?? "",
        },
      });
      const result = await exporter.exportSession({
        sessionId: "long-output",
        backendId: "pi",
        title: null,
        createdAtMs: 1,
        lastAccessedAtMs: 1,
        messages: [],
        extras: { entries: [entry] },
      });
      expect(result.ok).toBe(true);
      const restored = await exporter.importDocument("exports/long-output.json");
      expect(restored.ok).toBe(true);
      expect(JSON.stringify(restored)).toContain(originalText);
    });

    it("does not report success for an end without an entry or result", () => {
      const { translator, events } = createTranslator();
      translate(translator, toolStart("call-4", "read"));
      translate(translator, { type: "tool_execution_end", toolCallId: "call-4", toolName: "read" });

      expect(events[events.length - 1]).toMatchObject({
        kind: "tool_call_end",
        toolCallId: "pi:session-1:call-4",
        status: "interrupted",
      });
    });

    it("reports completed only with a real result and failed for an error result", () => {
      const { translator, events } = createTranslator();
      translate(translator, toolStart("call-5", "read"));
      translate(translator, {
        type: "tool_execution_end",
        toolCallId: "call-5",
        toolName: "read",
        result: { taskId: "task-5", isError: false, diagnostics: [], structuredOutput: "ok" },
      });
      translate(translator, toolStart("call-6", "read"));
      translate(translator, {
        type: "tool_execution_end",
        toolCallId: "call-6",
        toolName: "read",
        result: {
          taskId: "task-6",
          isError: true,
          diagnostics: [{ severity: "error", message: "permission denied", code: "denied" }],
        },
      });

      expect(events.filter((event) => event.kind === "tool_call_end")).toEqual([
        { kind: "tool_call_end", toolCallId: "pi:session-1:call-5", status: "completed" },
        {
          kind: "tool_call_end",
          toolCallId: "pi:session-1:call-6",
          status: "failed",
          errorMessage: "permission denied",
        },
      ]);
    });

    it("maps product tool names to stable kinds and vendor aliases", () => {
      expect(toolKindFor("read")).toBe("read");
      expect(toolKindFor("write")).toBe("edit");
      expect(toolKindFor("edit")).toBe("edit");
      expect(toolKindFor("bash")).toBe("execute");
      expect(toolKindFor("mcp__vault__search")).toBe("other");
    });

    it("marks an MCP tool named Agent with its server so the card is not a subagent", () => {
      const { translator, events } = createTranslator({
        mcpServerFor: (toolName) => (toolName === "Agent" ? "vault-mcp" : undefined),
      });

      translate(translator, {
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "Agent",
        args: {},
      });

      const created = events.find((event) => event.kind === "tool_call");
      expect(created).toMatchObject({
        kind: "tool_call",
        tool: { vendorToolName: "Agent", mcpServer: "vault-mcp", kind: "other" },
      });
    });
  });

  describe("lifecycle", () => {
    it("maps run, turn, retry and failure events into explicit state events", () => {
      const { translator, events } = createTranslator();
      translate(translator, { type: "run_start", inputs: ["submission-1"] });
      translate(translator, { type: "turn_start" });
      translate(translator, {
        type: "auto_retry_start",
        attempt: 1,
        at: 1_700_000_000_000,
        errorMessage: "rate limited",
      });
      translate(translator, { type: "auto_retry_end", attempt: 1 });
      translate(translator, { type: "turn_end" });
      translate(translator, {
        type: "task_failed",
        taskId: "task-1",
        kind: "pi.generation",
        message: "failed",
      });
      translate(translator, { type: "run_end", inputs: ["submission-1"] });

      expect(events).toEqual([
        { kind: "run", status: "running", inputs: ["submission-1"] },
        { kind: "turn", phase: "start" },
        { kind: "retry", phase: "start", attempt: 1, errorMessage: "rate limited" },
        { kind: "retry", phase: "end", attempt: 1 },
        { kind: "turn", phase: "end" },
        { kind: "task_failed", kindName: "pi.generation", message: "failed" },
        { kind: "run", status: "failed", inputs: ["submission-1"] },
      ]);
    });

    it("emits the committed entry and its final replacement on message end", () => {
      const { translator, events } = createTranslator();
      translate(
        translator,
        messageUpdate([{ type: "text_delta", contentIndex: 0, delta: "partial" }])
      );
      translate(translator, {
        type: "message_end",
        entry: {
          id: "entry-9",
          kind: "pi.assistant",
          model: [assistantMessage("committed answer")],
        },
      });

      expect(events).toEqual([
        { kind: "message_text", delta: "partial" },
        { kind: "message_text_replace", text: "committed answer" },
        { kind: "entry", entryId: "entry-9", entryKind: "pi.assistant" },
      ]);
    });

    it("resets live message state from a snapshot without inventing content", () => {
      const { translator, events } = createTranslator();
      translate(
        translator,
        messageUpdate([{ type: "text_delta", contentIndex: 0, delta: "stale" }])
      );
      translate(translator, {
        type: "snapshot",
        entries: [],
        tools: [],
        nestedTools: [],
        compactions: [],
        inbox: [],
        agent: {},
        usage: {},
        run: { inputs: ["submission-2"] },
      });

      expect(events[events.length - 1]).toEqual({
        kind: "snapshot",
        entries: 0,
        tools: 0,
        running: true,
      });
      expect(translator.currentText()).toBe("");
    });

    it("rejects an event outside the known union instead of silently dropping it", () => {
      const { translator, events } = createTranslator();
      expect(() => translator.translate({ type: "future_event" } as never)).toThrow(
        EventTranslatorError
      );
      expect(() => translator.translate({ type: "future_event" } as never)).toThrow(
        expect.objectContaining({ code: "UNKNOWN_EVENT" })
      );
      expect(events).toEqual([]);
    });
  });
});
