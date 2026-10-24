import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type { SessionUpdate } from "@/agentMode/session/types";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runStalledRuntimeScenario(directory: string, validation = false) {
  const vaultRoot = path.join(directory, "stalled-vault");
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
          limits: { context: 262144 },
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
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "stalled-fixture",
    getSecretById: (id: string) => (id === "fixture-key" ? "fixture-key" : null),
    setSecretById: () => undefined,
    deleteSecretById: () => undefined,
  };
  const options = {
    host: {
      app,
      keychain,
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  };
  let backend = new PiBackendProcess(options);
  const sessionId = "root-stalled-pause";
  try {
    await backend.start();
    await backend.newSession({ sessionId, cwd: vaultRoot });
    await backend.setSessionModel({ sessionId, modelId: "saved-model" });
    await backend.setSessionMode({ sessionId, modeId: "auto" });
    const updates: SessionUpdate[] = [];
    let ready!: () => void;
    const paused = new Promise<void>((resolve) => {
      ready = resolve;
    });
    backend.registerSessionHandler(sessionId, (event) => {
      updates.push(event.update);
      if (
        event.update.sessionUpdate === "recovery_state" &&
        event.update.recovery.status === "available" &&
        event.update.recovery.message?.includes("连续")
      )
        ready();
    });
    faux.setResponses([
      ...Array.from({ length: 3 }, () =>
        fauxAssistantMessage(
          [
            fauxToolCall(
              "todo_set",
              validation
                ? { expectedRevision: 0, items: "invalid" }
                : {
                    expectedRevision: 99,
                    items: [{ text: "核对资料", status: "in_progress", priority: "high" }],
                  },
              { id: "call_0" }
            ),
          ],
          { stopReason: "toolUse" }
        )
      ),
      ...(validation
        ? [
            fauxAssistantMessage(
              [
                fauxToolCall(
                  "todo_set",
                  {
                    expectedRevision: 0,
                    items: [{ text: "核对资料", status: "completed", priority: "high" }],
                  },
                  { id: "call_0" }
                ),
              ],
              { stopReason: "toolUse" }
            ),
          ]
        : []),
      (context) => {
        if (validation) {
          const material = JSON.stringify(context.messages);
          assert.ok(material.includes("host-sdk-tool-rejections"));
          assert.ok(material.includes("validation"));
          assert.ok(material.includes("invalid_arguments"));
        }
        return fauxAssistantMessage("继续后完成原有任务，保留前一段结果");
      },
    ]);
    const result = await backend.prompt({
      sessionId,
      requestId: "long-task",
      prompt: [{ type: "text", text: "完整核对资料，保存进度且不要重复完成的操作" }],
    });
    assert.equal(result.stopReason, "max_turn_requests");
    await paused;
    assert.equal(faux.state.callCount, 3);
    assert.ok(
      updates.some(
        (update) => update.sessionUpdate === "run_state" && update.run.status === "paused_stalled"
      )
    );
    assert.ok(
      !updates.some(
        (update) => update.sessionUpdate === "run_state" && update.run.status === "completed"
      )
    );
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    const replay: SessionUpdate[] = [];
    backend.registerSessionHandler(sessionId, (event) => replay.push(event.update));
    await backend.start();
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    assert.equal(faux.state.callCount, 3, "opening a paused task must not dispatch");
    if (validation) {
      const history = replay
        .filter((update) => update.sessionUpdate === "session_projection")
        .at(-1);
      assert.ok(history?.sessionUpdate === "session_projection");
      const cards = history.projection.messages
        .flatMap((message) => message.parts ?? [])
        .filter((part) => part.kind === "tool_call" && part.status === "failed");
      assert.equal(cards.length, 3);
      assert.ok(cards.every((part) => JSON.stringify(part).includes("not_applied")));
    }
    await backend.recoverSession({ sessionId, action: "continue" });
    assert.equal(
      faux.state.callCount,
      validation ? 5 : 4,
      "Continue must resume the saved generation, not submit the original input again"
    );
    const exported = await backend.exportSession({ sessionId, format: "json" });
    assert.ok(exported.content.includes("继续后完成原有任务"));
    const document = JSON.parse(exported.content) as {
      session: {
        extras: { entries: { kind: string; model?: { content?: { text?: string }[] }[] }[] };
      };
    };
    const entries = document.session.extras.entries;
    if (validation) {
      const failures = entries.filter(
        (entry) =>
          entry.kind === "pi.tool-result" && JSON.stringify(entry).includes("invalid_arguments")
      );
      assert.equal(failures.length, 3);
      const identityEntries = failures as unknown as { id: number; byTaskId: number }[];
      assert.equal(new Set(identityEntries.map((entry) => entry.byTaskId)).size, 3);
      const latest = updates
        .filter((update) => update.sessionUpdate === "session_projection")
        .at(-1);
      assert.ok(latest?.sessionUpdate === "session_projection");
      const cards = latest.projection.messages
        .flatMap((message) => message.parts ?? [])
        .filter((part) => part.kind === "tool_call" && part.status === "failed");
      assert.equal(
        new Set(cards.map((part) => (part.kind === "tool_call" ? part.id : ""))).size,
        3
      );
      assert.ok(cards.every((part) => JSON.stringify(part).includes("not_applied")));
      for (const entry of identityEntries)
        assert.ok(
          cards.some(
            (part) =>
              part.kind === "tool_call" && part.id === `pi-task:${sessionId}:${entry.byTaskId}`
          )
        );
    }
    assert.equal(
      entries.filter(
        (entry) =>
          entry.kind === "pi.user" &&
          entry.model?.[0]?.content?.some(
            (part) => part.text === "完整核对资料，保存进度且不要重复完成的操作"
          )
      ).length,
      1
    );
    return {
      status: "passed",
      checks: [
        "three_identical_failures_pause_without_another_request",
        "reopen_does_not_resume_work",
        "explicit_continue_resumes_original_generation",
        "goal_and_user_input_not_duplicated",
      ],
      providerCalls: faux.state.callCount,
    };
  } finally {
    await backend.shutdown();
  }
}
