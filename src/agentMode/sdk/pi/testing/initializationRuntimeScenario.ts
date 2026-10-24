import { withDiagnosticSummaries } from "@/agentMode/sdk/pi/testing/diagnosticSummaryProvider";
import type { App } from "obsidian";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type { VaultAgentSettings } from "@/settings/model";
import type { MessageContext } from "@/types/message";
import { requireNodeModule } from "@/utils/desktopRuntime";

export async function runInitializationRuntimeScenario(directory: string) {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        baseUrl: "https://fixture.invalid/v1",
        apiKeyKeychainId: "fixture-key",
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "saved-model",
        providerId: "fixture",
        info: { id: "fixture-model", toolCall: true, limits: { context: 8192, output: 1024 } },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      offerFeedbackCards: false,
      backends: {},
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
  const backend = new PiBackendProcess({
    host: {
      app,
      privateRoot: path.join(directory, "private"),
      getSettings: () => settings,
      streamsFactory: () => withDiagnosticSummaries(faux.provider),
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "initialization-fixture",
        getSecretById: (id) => (id === "fixture-key" ? "fixture-key-value" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
    },
  });
  let entered!: () => void;
  let finish!: () => void;
  const providerEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releaseProvider = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let ui: AgentSession | undefined;
  try {
    await backend.start();
    const opened = await backend.newSession({ sessionId: "root-initialization", cwd: vaultRoot });
    faux.setResponses([
      async () => {
        entered();
        await releaseProvider;
        return fauxAssistantMessage("Entry completed while the UI was initializing.");
      },
    ]);
    const running = backend.prompt({
      sessionId: opened.sessionId,
      requestId: "during-attach",
      prompt: [{ type: "text", text: "A background request is already running." }],
    });
    await providerEntered;
    ui = new AgentSession({
      backend,
      backendSessionId: opened.sessionId,
      internalId: "initializing-ui",
      backendId: "pi",
      cwd: vaultRoot,
    });
    assert.equal(ui.getStatus(), "starting");
    const loading = backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
    finish();
    await running;
    assert.equal(
      ui.getStatus(),
      "starting",
      "the first actual entry must reach the still-initializing UI"
    );
    assert.equal(
      ui.store
        .getDisplayMessages()
        .filter((message) => message.message === "Entry completed while the UI was initializing.")
        .length,
      1
    );
    ui.completeResume((await loading).state);
    await ui.ready;
    await backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
    const first = ui.store.getDisplayMessages();
    assert.equal(first.length, 2);
    assert.equal(
      first.filter((message) => message.message === "A background request is already running.")
        .length,
      1
    );
    assert.equal(
      first.filter(
        (message) => message.message === "Entry completed while the UI was initializing."
      ).length,
      1
    );
    const originalIds = first.map((message) => message.id);
    const selection: MessageContext = {
      notes: [],
      urls: [],
      selectedTextContexts: [
        {
          id: "original-selection",
          sourceType: "note",
          content: "Only this selected text.",
          noteTitle: "Original",
          notePath: "Original.md",
          startLine: 2,
          endLine: 3,
        },
      ],
    };
    faux.setResponses([fauxAssistantMessage("The selected source was preserved.")]);
    const { userMessageId, turn } = ui.sendPrompt("Use my selected source.", selection);
    assert.equal(await turn, "end_turn");
    const messages = ui.store.getDisplayMessages();
    const conversationMessages = messages.filter(
      (message) => !message.parts?.some((part) => part.kind === "compaction")
    );
    assert.equal(conversationMessages.length, 4);
    assert.deepEqual(
      conversationMessages.slice(0, 2).map((message) => message.id),
      originalIds
    );
    const user = messages.find((message) => message.id === userMessageId);
    assert.equal(
      user?.message,
      "Use my selected source.",
      JSON.stringify({ userMessageId, messages })
    );
    assert.equal(
      user?.context,
      selection,
      "the authoritative runtime projection must preserve the original UI selection object"
    );
    assert.equal(
      messages.filter((message) => message.message === "The selected source was preserved.").length,
      1
    );
    await backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
    assert.deepEqual(
      ui.store.getDisplayMessages().map((message) => message.id),
      messages.map((message) => message.id)
    );
    assert.equal(
      ui.store.getDisplayMessages().find((message) => message.id === userMessageId)?.context,
      selection
    );
    assert.equal(faux.state.callCount, 2);
    const beforeCommand = ui.store.getDisplayMessages();
    assert.equal(await ui.sendPrompt("/model saved-model").turn, "end_turn");
    const afterCommand = ui.store.getDisplayMessages();
    assert.equal(afterCommand.length, beforeCommand.length + 1);
    assert.equal(afterCommand.at(-1)?.sender, "user");
    assert.equal(afterCommand.at(-1)?.message, "/model saved-model");
    assert.equal(
      afterCommand.some((message) => message.isErrorMessage),
      false
    );
    assert.equal(faux.state.callCount, 2, "a local command cannot request an empty model answer");
    return {
      status: "passed",
      scope:
        "actual_backend_sdk_and_session_store_with_diagnostic_provider_not_desktop_or_actual_model",
      providerCalls: 2,
      checks: [
        "actual_entry_arrives_before_ui_initialization_finishes_once",
        "history_reload_does_not_duplicate_the_initializing_entry",
        "actual_projection_preserves_optimistic_user_id_and_selection_identity",
        "repeat_reload_preserves_display_order_and_ids",
        "actual_local_command_has_no_model_request_or_false_empty_answer_error",
      ],
    };
  } finally {
    finish();
    await ui?.dispose();
    await backend.shutdown();
  }
}
