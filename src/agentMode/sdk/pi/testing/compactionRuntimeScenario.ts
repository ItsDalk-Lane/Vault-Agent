import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionEvent } from "@/agentMode/session/types";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { withDiagnosticSummaries } from "@/agentMode/sdk/pi/testing/diagnosticSummaryProvider";
import { readStoredWorkItem } from "@/agentMode/sdk/pi/testing/readStoredWorkItem";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runCompactionRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        baseUrl: "https://fixture.invalid/v1",
        origin: { kind: "byok" },
        apiKeyKeychainId: "key",
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "saved",
        providerId: "fixture",
        info: { id: "model", toolCall: true, limits: { context: 8192, output: 1024 } },
        configuredAt: 1,
      },
    ],
    agentMode: { activeBackend: "pi", backends: {}, skills: { folder: "skills" } },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const app = {
    vault: {
      configDir: ".fixture-config",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [],
      getMarkdownFiles: () => [],
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const faux = fauxProvider();
  const summaryContexts: TranscriptContext[] = [];
  const options = {
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "compact",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () =>
        withDiagnosticSummaries(faux.provider, (context) => summaryContexts.push(context)),
    },
  };
  let backend = new PiBackendProcess(options);
  const events: SessionEvent[] = [];
  let reopened: PiBackendProcess | undefined;
  try {
    await backend.start();
    const opened = await backend.newSession({ sessionId: "root-compact", cwd: vaultRoot });
    backend.registerSessionHandler(opened.sessionId, (event) => events.push(event));
    const prompt = async (text: string, requestId: string) => {
      try {
        return await backend.prompt({
          sessionId: opened.sessionId,
          requestId,
          prompt: [{ type: "text", text }],
        });
      } catch (error) {
        throw new Error(`${requestId}, calls=${faux.state.callCount}: ${String(error)}`);
      }
    };
    await prompt("/compact", "empty-compact");
    assert.equal(faux.state.callCount, 0, "no-range compaction must skip without billing");
    assert.equal(
      Number(summaryContexts.length),
      0,
      "no-range compaction must not call a summary model"
    );
    assert.ok(
      events.some(
        (event) => event.update.sessionUpdate === "compaction" && event.update.status === "skipped"
      )
    );
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("todo_set", {
            expectedRevision: 0,
            items: [{ text: "保留待办检查点", status: "pending", priority: "high" }],
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage(`原始回答:${"old material ".repeat(800)}`),
    ]);
    const older = "保留的原始问题";
    await prompt(older, "older");
    assert.equal(
      faux.state.callCount,
      2,
      "ordinary generations must consume exactly the tool-call and final-answer responses"
    );
    const initialBackup = JSON.parse(
      (await backend.exportSession({ sessionId: opened.sessionId, format: "json" })).content
    ) as {
      session: {
        extras: {
          entries: {
            id: number;
            kind: string;
            data?: { requestId?: string; runId?: string };
            model?: { details?: { outcome?: { operationId: string } } }[];
          }[];
        };
      };
    };
    const toolReceipt = initialBackup.session.extras.entries.find(
      (entry) => entry.kind === "pi.tool-result" && entry.model?.[0].details?.outcome
    );
    assert.ok(toolReceipt?.model?.[0].details?.outcome);
    const operationId = toolReceipt.model[0].details.outcome.operationId;
    const originalWorkId = [...initialBackup.session.extras.entries]
      .reverse()
      .find((entry) => entry.kind === "va.run" && entry.data?.requestId === "older")?.data?.runId;
    assert.ok(originalWorkId);
    await backend.shutdown();
    const readWork = () =>
      readStoredWorkItem({
        privateRoot: options.host.privateRoot,
        vaultRoot,
        vaultId: "compact",
        sessionId: opened.sessionId,
        workId: originalWorkId,
      });
    const beforeMaintenance = await readWork();
    assert.ok(beforeMaintenance);
    assert.equal(beforeMaintenance.checkpoint.goal, older);
    assert.equal(
      beforeMaintenance.grants.length,
      1,
      "an empty maintenance command cannot grant a later task an extra segment"
    );
    const summariesBeforeMaintenance = summaryContexts.length;
    backend = new PiBackendProcess(options);
    await backend.start();
    backend.registerSessionHandler(opened.sessionId, (event) => events.push(event));
    await backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
    assert.equal(
      summaryContexts.length,
      summariesBeforeMaintenance,
      "opening unfinished work must not summarize it"
    );
    await prompt("/compact", "real-compact");
    assert.equal(
      faux.state.callCount,
      2,
      "manual or automatic summaries cannot consume ordinary replies"
    );
    assert.ok(
      summaryContexts.length > 0,
      "the actual 8k SDK context must have summarized at least once"
    );
    const summaryMaterial = summaryContexts
      .flatMap((context) =>
        context.messages.flatMap((message) =>
          typeof message.content === "string"
            ? [message.content]
            : message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
        )
      )
      .find((text) => text.startsWith("<host-summary-evidence>") && text.includes(operationId));
    assert.ok(
      summaryMaterial,
      "an actual summary request must receive the stored operation receipt"
    );
    const summaryFacts = JSON.parse(
      summaryMaterial.slice("<host-summary-evidence>".length, -"</host-summary-evidence>".length)
    ) as {
      checkpoint: { source: string; workItemId: string; remainingItems?: string[] };
      evidence: { entryId: string; metadata: string }[];
    };
    assert.equal(summaryFacts.checkpoint.source, "va.work-items");
    assert.ok(summaryFacts.checkpoint.remainingItems?.includes("保留待办检查点"));
    assert.ok(
      summaryFacts.evidence.some(
        (item) =>
          item.entryId === String(toolReceipt.id) &&
          item.metadata.includes(operationId) &&
          item.metadata.includes('"effect":"applied"')
      )
    );
    assert.ok(
      events.some(
        (event) =>
          event.update.sessionUpdate === "compaction" && event.update.status === "completed"
      )
    );
    const backup = await backend.exportSession({ sessionId: opened.sessionId, format: "json" });
    assert.ok(backup.content.includes(older), "compaction must retain original history");
    assert.ok(backup.content.includes("Continue the original diagnostic task."));
    const persistedRuns = (
      JSON.parse(backup.content) as {
        session: { extras: { entries: { kind: string; data?: { runId?: string } }[] } };
      }
    ).session.extras.entries;
    assert.ok(
      persistedRuns.some(
        (entry) =>
          entry.kind === "va.run" && entry.data?.runId === summaryFacts.checkpoint.workItemId
      ),
      "summary checkpoint must refer to the actual persisted work item"
    );
    assert.ok(
      persistedRuns
        .filter((entry) => entry.kind === "va.run")
        .slice(-2)
        .every((entry) => entry.data?.runId === originalWorkId),
      "manual maintenance must retain the original work identifier"
    );
    const rows = events.flatMap((event) =>
      event.update.sessionUpdate === "session_projection" ? event.update.projection.messages : []
    );
    assert.ok(
      !rows.some(
        (message) =>
          message.sender === "ai" &&
          message.message.includes("Continue the original diagnostic task.")
      ),
      "summary must render only as a compaction row"
    );
    const callsAtReopen = Number(faux.state.callCount) + Number(summaryContexts.length);
    await backend.shutdown();
    const afterMaintenance = await readWork();
    assert.ok(afterMaintenance);
    assert.equal(afterMaintenance.checkpoint.goal, older);
    assert.deepEqual(
      afterMaintenance.grants,
      beforeMaintenance.grants,
      "maintenance is not a new grant"
    );
    assert.equal(
      afterMaintenance.checkpoint.userRequests?.some((input) =>
        input.text.trim().startsWith("/compact")
      ),
      false
    );
    assert.equal(
      afterMaintenance.reservations.length,
      beforeMaintenance.reservations.length + summaryContexts.length - summariesBeforeMaintenance,
      "all maintenance summaries consume the original cumulative budget"
    );
    reopened = new PiBackendProcess(options);
    const replay: SessionEvent[] = [];
    reopened.registerSessionHandler(opened.sessionId, (event) => replay.push(event));
    await reopened.start();
    await reopened.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
    assert.ok(
      replay.some(
        (event) =>
          event.update.sessionUpdate === "session_projection" &&
          event.update.projection.messages.some((message) => message.message === older)
      )
    );
    const saved = await reopened.exportSession({ sessionId: opened.sessionId, format: "json" });
    const savedEntries = (
      JSON.parse(saved.content) as {
        session: { extras: { entries: { kind: string; data?: { status?: string } }[] } };
      }
    ).session.extras.entries;
    assert.ok(
      savedEntries.some(
        (entry) => entry.kind === "va.compaction" && entry.data?.status === "completed"
      )
    );
    assert.equal(Number(faux.state.callCount) + Number(summaryContexts.length), callsAtReopen);
    faux.setResponses([
      (context) => {
        assert.ok(
          JSON.stringify(context.messages).includes(older),
          "cold Continue after maintenance must still see the original goal"
        );
        return fauxAssistantMessage(
          [
            fauxToolCall("todo_set", {
              expectedRevision: 1,
              items: [{ text: "保留待办检查点", status: "completed", priority: "high" }],
            }),
          ],
          { stopReason: "toolUse" }
        );
      },
      fauxAssistantMessage("原始任务已完成"),
    ]);
    const beforeContinue = Number(faux.state.callCount);
    await reopened.recoverSession({ sessionId: opened.sessionId, action: "continue" });
    assert.equal(Number(faux.state.callCount), beforeContinue + 2);
    await reopened.shutdown();
    const afterContinue = await readWork();
    assert.ok(afterContinue);
    assert.equal(afterContinue.checkpoint.goal, older);
    assert.equal(afterContinue.grants.length, beforeMaintenance.grants.length + 1);
    return {
      status: "passed",
      checks: [
        "empty_compaction_skipped_without_request",
        "small_model_actual_compaction",
        "summary_placed_as_context_head",
        "original_history_retained",
        "compaction_has_no_fake_answer",
        "reopen_retains_summary_without_request",
        "summary_receives_owned_persisted_checkpoint_and_operation_evidence",
        "manual_compact_preserves_goal_grants_and_cumulative_budget",
        "cold_continue_after_compact_uses_original_goal",
      ],
      providerCalls: Number(faux.state.callCount) + Number(summaryContexts.length),
      mainCalls: faux.state.callCount,
      summaryCalls: summaryContexts.length,
    };
  } finally {
    await reopened?.shutdown();
    await backend.shutdown();
  }
}
