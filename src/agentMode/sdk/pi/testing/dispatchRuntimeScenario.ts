import { readStoredWorkItem } from "@/agentMode/sdk/pi/testing/readStoredWorkItem";
import { withDiagnosticSummaries } from "@/agentMode/sdk/pi/testing/diagnosticSummaryProvider";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type { SessionUpdate } from "@/agentMode/session/types";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

interface DispatchEntry {
  readonly kind: string;
  readonly data: {
    readonly purpose?: string;
    readonly runId?: string;
    readonly requestId?: string;
    readonly modelAttempts?: number;
  };
}

export async function runDispatchRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "dispatch-vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        displayName: "Fixture",
        baseUrl: "http://127.0.0.1:9999/v1",
        apiKeyKeychainId: "fixture-key",
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "saved-model",
        providerId: "fixture",
        info: {
          id: "fixture-model",
          displayName: "Fixture",
          toolCall: true,
          limits: { context: 8192 },
        },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: {},
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["saved-model"] } },
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
  let rawCredentialReads = 0;
  let mutateEndpoint = false;
  let disableProvider = false;
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "dispatch-fixture",
    getSecretById: (id: string) => {
      if (id !== "fixture-key") return null;
      rawCredentialReads += 1;
      if (mutateEndpoint && rawCredentialReads === 2)
        settings.providers.fixture.baseUrl = "http://127.0.0.1:9998/v1";
      if (disableProvider && rawCredentialReads === 2) settings.providers.fixture.enabled = false;
      return "test-key";
    },
    setSecretById: () => undefined,
    deleteSecretById: () => undefined,
  };
  const backend = new PiBackendProcess({
    host: {
      app,
      keychain,
      getSettings: () => settings,
      privateRoot: path.join(directory, "dispatch-private"),
      streamsFactory: () => withDiagnosticSummaries(faux.provider),
    },
  });
  try {
    await backend.start();
    const root = await backend.newSession({
      sessionId: "root-dispatch-same-model",
      cwd: vaultRoot,
    });
    const updates: SessionUpdate[] = [];
    backend.registerSessionHandler(root.sessionId, (event) => updates.push(event.update));
    faux.setResponses([
      () => {
        const initialBudget = updates.find(
          (update) => update.sessionUpdate === "plan_usage_update"
        );
        assert.equal(
          initialBudget?.planUsage?.windows[0]?.percent,
          0,
          "the real run must publish its own budget before opening the provider"
        );
        return fauxAssistantMessage(
          [
            fauxToolCall("delegate_task", {
              profileId: "researcher",
              task: "核查",
              description: "同模型子任务",
              modelKey: "saved-model",
            }),
          ],
          { stopReason: "toolUse" }
        );
      },
      fauxAssistantMessage("同模型子任务答案"),
      fauxAssistantMessage("父任务最终答案"),
    ]);
    await backend.prompt({
      sessionId: root.sessionId,
      requestId: "same-model-child",
      prompt: [{ type: "text", text: "用同一个模型委派核查" }],
    });
    assert.equal(faux.state.callCount, 3);
    const backup = JSON.parse(
      (await backend.exportSession({ sessionId: root.sessionId, format: "json" })).content
    ) as { session: { extras: { entries: DispatchEntry[] } } };
    const originalRunId = backup.session.extras.entries
      .filter((entry) => entry.kind === "va.run" && entry.data.requestId === "same-model-child")
      .at(-1)?.data.runId;
    assert.ok(originalRunId);
    const originalReservations = backup.session.extras.entries.filter(
      (entry) => entry.kind === "va.budget" && entry.data.runId === originalRunId
    );
    const purposes = backup.session.extras.entries
      .filter((entry) => entry.kind === "va.budget")
      .map((entry) => entry.data.purpose);
    assert.deepEqual(
      purposes.filter((purpose) => purpose !== "compaction"),
      ["root", "subagent", "root"],
      "the hard gate must identify the real conversation even when parent and child use the same model"
    );
    const latestBudget = updates
      .filter((update) => update.sessionUpdate === "plan_usage_update")
      .at(-1);
    assert.ok(latestBudget?.planUsage, "real provider dispatch must publish its local run budget");
    assert.deepEqual(
      latestBudget.planUsage.windows.map((window) => ({
        id: window.id,
        source: window.source,
        percent: window.percent,
      })),
      [
        {
          id: "local_requests",
          source: "local_budget",
          percent: Math.round((purposes.length / 32) * 100),
        },
      ]
    );
    await backend.closeSession({ sessionId: root.sessionId });
    updates.length = 0;
    await backend.loadSession({ sessionId: root.sessionId, cwd: vaultRoot });
    const reopenedBudget = updates
      .filter((update) => update.sessionUpdate === "plan_usage_update")
      .at(-1);
    assert.deepEqual(
      reopenedBudget?.planUsage,
      latestBudget.planUsage,
      "reopening restores the persisted local budget without another model request"
    );
    assert.equal(faux.state.callCount, 3);
    updates.length = 0;
    const before = faux.state.callCount;
    rawCredentialReads = 0;
    mutateEndpoint = true;
    faux.setResponses([fauxAssistantMessage("This request must never open")]);
    await backend
      .prompt({
        sessionId: root.sessionId,
        requestId: "denied-endpoint",
        prompt: [{ type: "text", text: "Check the final endpoint boundary" }],
      })
      .catch(() => undefined);
    assert.ok(
      rawCredentialReads >= 2,
      "the fixture must change the endpoint during the final credential check"
    );
    assert.equal(
      faux.state.callCount,
      before,
      "an endpoint changed during the guard must not open an old or new network stream"
    );
    assert.equal(
      updates.find((update) => update.sessionUpdate === "plan_usage_update")?.planUsage?.windows[0]
        ?.percent,
      Math.round((originalReservations.length / 64) * 100),
      "an explicit follow-up adds one segment while retaining previous work usage before provider dispatch"
    );
    const deniedBackup = JSON.parse(
      (await backend.exportSession({ sessionId: root.sessionId, format: "json" })).content
    ) as { session: { extras: { entries: DispatchEntry[] } } };
    const deniedRun = deniedBackup.session.extras.entries
      .filter((entry) => entry.kind === "va.run" && entry.data.requestId === "denied-endpoint")
      .at(-1)?.data;
    assert.equal(
      deniedRun?.runId,
      originalRunId,
      "endpoint rejection must not replace the unfinished work identity"
    );
    const deniedReservations = deniedBackup.session.extras.entries.filter(
      (entry) => entry.kind === "va.budget" && entry.data.runId === originalRunId
    );
    assert.deepEqual(
      deniedReservations.slice(0, originalReservations.length),
      originalReservations,
      "a follow-up cannot discard old committed reservations"
    );
    assert.equal(
      deniedReservations.length - originalReservations.length,
      1,
      "the final endpoint recheck rejects after one durable attempt reservation and before opening any network stream"
    );
    assert.equal(deniedRun?.modelAttempts, originalReservations.length);
    await backend.closeSession({ sessionId: root.sessionId });
    const refunded = await readStoredWorkItem({
      privateRoot: path.join(directory, "dispatch-private"),
      vaultRoot,
      vaultId: "dispatch-fixture",
      sessionId: root.sessionId,
      workId: originalRunId,
    });
    assert.deepEqual(
      refunded?.reservations,
      originalReservations.map((entry) => entry.data),
      "a refusal before opening a stream refunds the reservation in the canonical Durable work record"
    );
    mutateEndpoint = false;
    settings.providers.fixture.baseUrl = "http://127.0.0.1:9999/v1";
    updates.length = 0;
    await backend.loadSession({ sessionId: root.sessionId, cwd: vaultRoot });
    assert.equal(faux.state.callCount, before);
    assert.equal(
      updates.filter((update) => update.sessionUpdate === "plan_usage_update").at(-1)?.planUsage
        ?.windows[0]?.percent,
      Math.round((originalReservations.length / 64) * 100),
      "cold reopening preserves the refund and starts no model request"
    );
    // 停用发生在最后凭据检查期间时也不能继续向旧供应商发送。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    mutateEndpoint = false;
    settings.providers.fixture.baseUrl = "http://127.0.0.1:9999/v1";
    rawCredentialReads = 0;
    disableProvider = true;
    await backend
      .prompt({
        sessionId: root.sessionId,
        prompt: [{ type: "text", text: "Check disabled provider at final dispatch boundary" }],
      })
      .catch(() => undefined);
    assert.equal(settings.providers.fixture.enabled, false);
    assert.equal(
      faux.state.callCount,
      before,
      "disabling a provider must block the next stream in an ongoing conversation"
    );
    return {
      status: "passed",
      checks: [
        "provider_session_identity_for_same_model_child",
        "endpoint_change_during_guard_denied",
        "final_gate_refund_persisted_and_cold_reopen_no_model",
        "provider_disabled_during_guard_denied",
        "actual_local_request_budget_is_visible",
        "reopen_restores_local_budget_without_model_call",
        "followup_preserves_work_identity_and_cumulative_budget_before_provider",
      ],
      providerCalls: faux.state.callCount,
      purposes,
    };
  } finally {
    await backend.shutdown();
  }
}
