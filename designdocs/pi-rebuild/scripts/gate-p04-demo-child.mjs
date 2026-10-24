import type { AgentEvent } from "@earendil-works/pi-durable";

import {
  ProjectionReducer,
  projectEntry,
  type ProjectionEntrySource,
} from "@/agentMode/sdk/pi/events/ProjectionReducer";
import { HistoryProjector } from "@/agentMode/sdk/pi/events/HistoryProjector";
import { ToolProjection } from "@/agentMode/sdk/pi/events/ToolProjection";
import { RunProjection } from "@/agentMode/sdk/pi/events/RunProjection";
import { REPLAY_SAMPLE_ENTRIES } from "@/agentMode/sdk/pi/testing/replaySample";
import { agentResponseText } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart } from "@/agentMode/session/types";

// GATE-P04 child: drives the real projection modules with a conversation recorded from a real
// Durable Harness + faux provider. It proves resync dedupe, compacted-history retention, tool
// terminal evidence rules, run duration/loading semantics and copy/Markdown regression:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
interface SampleEntry {
  readonly id: string;
  readonly kind: string;
  readonly model: readonly unknown[] | null;
}

interface Report {
  result: string;
  resync: {
    uniqueIds: boolean;
    compactedKept: boolean;
    newEntryOnce: boolean;
    entryCount: number;
  };
  snapshot: { oldKept: boolean };
  toolTerminal: {
    interrupted: boolean;
    failedOnError: boolean;
    completedWithResult: boolean;
    lateUpdateIgnored: boolean;
  };
  run: {
    loadingThroughTurns: boolean;
    durationMs: number | undefined;
    unknownUsageNull: boolean;
    retryDeduped: boolean;
    terminalStatus: string;
  };
  rendering: { copyTextMatches: boolean; codeBlock: boolean; link: boolean; durationMs: number | undefined };
}

function sources(entries: readonly SampleEntry[]): ProjectionEntrySource[] {
  return entries.map((entry, index) => ({
    id: Number(/^\d+$/.test(entry.id) ? entry.id : index),
    kind: entry.kind,
    model: (entry.model ?? []) as never,
  }));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function main(): Promise<void> {
  const entries = REPLAY_SAMPLE_ENTRIES as readonly SampleEntry[];
  const projected: ProjectionEntrySource[] = sources(entries);
  const assistantEntries = entries.filter((entry) => entry.kind === "pi.assistant");
  const activeSnapshot = [projected[projected.length - 1]!];
  const olderPages = projected.slice(0, projected.length - 1);
  const newEntry: ProjectionEntrySource = {
    id: 999,
    kind: "pi.assistant",
    model: [{ content: [{ type: "text", text: "live entry appended during initialization" }] }] as never,
  };

  const reducer = new ProjectionReducer();
  const started = deferred<{
    snapshot: { entries: ProjectionEntrySource[] };
    start(listener: (events: readonly AgentEvent[]) => Promise<void>): void;
    stop(): Promise<unknown>;
  }>();
  let listener: ((events: readonly AgentEvent[]) => Promise<void>) | null = null;
  const pages = deferred<void>();
  const projector = new HistoryProjector({
    reducer,
    async attach() {
      const watch = {
        snapshot: { entries: activeSnapshot },
        start(next: (events: readonly AgentEvent[]) => Promise<void>) {
          listener = next;
          started.resolve(watch);
        },
        async stop() {
          return undefined;
        },
      };
      return watch;
    },
    async loadPage(cursor) {
      await pages.promise;
      return cursor === null
        ? { entries: olderPages, nextCursor: 1 }
        : { entries: [], nextCursor: null };
    },
  });

  const initialization = projector.initialize();
  const watch = await started.promise;
  const emit = listener as ((events: readonly AgentEvent[]) => Promise<void>) | null;
  const appended = {
    type: "entry_appended",
    entry: { id: 999, kind: "pi.assistant", model: [{ content: [{ type: "text", text: "live entry appended during initialization" }] }] },
  } as unknown as AgentEvent;
  const duplicateAppend = {
    type: "entry_appended",
    entry: { id: 999, kind: "pi.assistant", model: [{ content: [{ type: "text", text: "live entry appended during initialization" }] }] },
  } as unknown as AgentEvent;
  if (emit !== null) {
    await emit([appended]);
    await emit([duplicateAppend]);
  }
  void watch;
  pages.resolve();
  const initialized = await initialization;
  const ids = initialized.projection.entries.map((entry) => entry.id);
  const uniqueIds = new Set(ids).size === ids.length;
  const compactedKept = olderPages.every((entry) => ids.includes(String(entry.id)));
  const newEntryOnce = ids.filter((id) => Number(id) === 999).length === 1;

  const snapshotReducer = new ProjectionReducer();
  const snapshotEpoch = snapshotReducer.beginEpoch();
  snapshotReducer.apply({
    streamEpoch: snapshotEpoch,
    entries: [
      projectEntry({ id: 1, kind: "pi.user", model: [{ content: "old question" }] as never }),
      projectEntry({ id: 2, kind: "pi.compaction", model: [{ content: "summary" }] as never }),
    ],
  });
  const afterSnapshot = snapshotReducer.apply({
    streamEpoch: snapshotEpoch,
    snapshot: [projectEntry({ id: 3, kind: "pi.assistant", model: [{ content: "active" }] as never })],
    reset: true,
  });
  const oldKept =
    afterSnapshot !== null && afterSnapshot.entries.map((entry) => entry.id).join(",") === "1,2,3";

  const tools = new ToolProjection({ sessionId: "gate-p04" });
  tools.project({
    type: "tool_execution_start",
    toolCallId: "orphan",
    toolName: "read_note",
    args: {},
  } as unknown as AgentEvent);
  const orphanEnd = tools.project({
    type: "tool_execution_end",
    toolCallId: "orphan",
    toolName: "read_note",
  } as unknown as AgentEvent);
  const interrupted = orphanEnd[0]?.kind === "tool_call_end" && orphanEnd[0].status === "interrupted";

  const rejected = new ToolProjection({ sessionId: "gate-p04" });
  rejected.project({
    type: "tool_execution_start",
    toolCallId: "denied",
    toolName: "write",
    args: {},
  } as unknown as AgentEvent);
  const rejectedEnd = rejected.project({
    type: "tool_execution_end",
    toolCallId: "denied",
    toolName: "write",
    result: {
      taskId: "task-1",
      isError: true,
      diagnostics: [{ severity: "error", message: "User denied permission", code: "PERMISSION_DENIED" }],
    },
  } as unknown as AgentEvent);
  const failedOnError = rejectedEnd[0]?.kind === "tool_call_end" && rejectedEnd[0].status === "failed";

  const completed = new ToolProjection({ sessionId: "gate-p04" });
  completed.project({
    type: "tool_execution_start",
    toolCallId: "done",
    toolName: "read_note",
    args: {},
  } as unknown as AgentEvent);
  const completedEnd = completed.project({
    type: "tool_execution_end",
    toolCallId: "done",
    toolName: "read_note",
    result: { taskId: "task-2", isError: false, diagnostics: [] },
  } as unknown as AgentEvent);
  const completedWithResult =
    completedEnd[0]?.kind === "tool_call_end" && completedEnd[0].status === "completed";
  completed.project({
    type: "tool_execution_update",
    toolCallId: "done",
    toolName: "read_note",
    output: { append: "late" },
  } as unknown as AgentEvent);
  const lateUpdateIgnored = completed.snapshot("pi:gate-p04:done")?.status === "completed";

  const run = new RunProjection({ runId: "run-1", requestId: "request-1", startedAtMs: 1_000 });
  run.start(1_000);
  run.acceptSubmission("submission-1");
  run.turnEnded(1_500);
  run.turnEnded(2_000);
  const loadingThroughTurns = run.isLoading();
  run.retryStarted(1, "rate limited", 2_500);
  run.retryEnded(1, 3_000);
  const retryDeduped = run.acceptSubmission("submission-1") === false;
  const terminal = run.finish("end_turn", 4_000);
  const unknownUsageNull = run.usageFrom({}, 4_000) === null;

  const assistantText = assistantEntries
    .map((entry) =>
      (entry.model ?? [])
        .map((message) => {
          const content = (message as { content?: unknown }).content;
          if (typeof content === "string") return content;
          if (!Array.isArray(content)) return "";
          return content
            .filter((block): block is { type: "text"; text: string } => {
              return (
                typeof block === "object" &&
                block !== null &&
                (block as { type?: string }).type === "text"
              );
            })
            .map((block) => block.text)
            .join("");
        })
        .join("")
    )
    .filter((text) => text.length > 0);
  const answer = assistantText[assistantText.length - 1] ?? "";
  const parts: AgentMessagePart[] = [
    { kind: "thought", text: "internal reasoning that must stay out of the copy" },
    {
      kind: "tool_call",
      id: "pi:gate-p04:call-1",
      title: "read_note",
      status: "completed",
      output: [{ type: "text", text: "tool diagnostic output" }],
    },
    { kind: "text", text: answer },
  ];
  const copyText = agentResponseText(parts);

  const report: Report = {
    result: "passed",
    resync: {
      uniqueIds,
      compactedKept,
      newEntryOnce,
      entryCount: initialized.projection.entries.length,
    },
    snapshot: { oldKept },
    toolTerminal: { interrupted, failedOnError, completedWithResult, lateUpdateIgnored },
    run: {
      loadingThroughTurns,
      durationMs: run.durationMs(),
      unknownUsageNull,
      retryDeduped,
      terminalStatus: terminal.status,
    },
    rendering: {
      copyTextMatches: copyText === answer,
      codeBlock: answer.includes("```ts"),
      link: answer.includes("[the plan](Notes/plan.md)"),
      durationMs: run.durationMs(),
    },
  };
  process.stdout.write(JSON.stringify(report));
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
