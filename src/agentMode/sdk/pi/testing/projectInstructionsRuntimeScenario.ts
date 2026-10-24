import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { withDiagnosticSummaries } from "./diagnosticSummaryProvider";
import { createCopilotPatternFilter } from "@/search/searchUtils";
import { getSettings, setSettings } from "@/settings/model";

export async function runProjectInstructionsRuntimeScenario(directory: string) {
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
        configuredModelId: "saved",
        providerId: "fixture",
        info: { id: "model", toolCall: true, limits: { context: 262144, output: 1024 } },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      backends: {},
      skills: { folder: "skills" },
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const priorSettings = getSettings();
  const managedFolder = "项目规则验收";
  setSettings({ vaultAgentFolder: managedFolder, qaInclusions: "", qaExclusions: managedFolder });
  const projectRelative = `${managedFolder}/projects/中文工程`;
  const workspaceRoot = path.join(vaultRoot, projectRelative);
  await fs.mkdir(workspaceRoot, { recursive: true });
  const app = {
    vault: {
      configDir: ".fixture",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: () => null,
      getFiles: () => [],
      getMarkdownFiles: () => [],
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const faux = fauxProvider();
  let instructionAllowed = true;
  const options = {
    host: {
      app,
      isVaultPathAllowed: (source: string) => createCopilotPatternFilter(app)(source),
      isInstructionPathAllowed: (source: string) =>
        source !== `${projectRelative}/AGENTS.md` || instructionAllowed,
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => withDiagnosticSummaries(faux.provider),
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "project-instructions",
        getSecretById: (id: string) => (id === "fixture-key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
    },
  };
  const backend = new PiBackendProcess(options);
  const rootInstruction = "根目录约定：保留原文，核对后再给出结论。";
  const first = "项目口令：" + "中文约定".repeat(24) + "甲";
  const second = "项目口令：" + "中文约定".repeat(24) + "乙";
  const instructions = path.join(workspaceRoot, "AGENTS.md");
  await fs.writeFile(path.join(vaultRoot, "AGENTS.md"), rootInstruction);
  await fs.writeFile(instructions, first);
  const { getCurrentSystemPrompt } = await import("@earendil-works/pi-ai/utils/transcript");
  try {
    assert.equal(options.host.isVaultPathAllowed("AGENTS.md"), false);
    assert.equal(options.host.isVaultPathAllowed(`${projectRelative}/AGENTS.md`), false);
    await backend.start();
    const sessionId = "root-project-instructions";
    await backend.newSession({ sessionId, cwd: workspaceRoot });
    faux.setResponses([
      async (context) => {
        const system = getCurrentSystemPrompt(context.messages);
        assert.ok(
          system.includes(first),
          "the real app path policies must deliver a small Chinese AGENTS file from the selected project CWD to the actual SDK provider"
        );
        assert.ok(system.includes(rootInstruction));
        await fs.writeFile(instructions, second);
        return fauxAssistantMessage([fauxToolCall("todo_get", {})], { stopReason: "toolUse" });
      },
      (context) => {
        const system = getCurrentSystemPrompt(context.messages);
        assert.ok(system.includes(second));
        assert.ok(!system.includes(first));
        setSettings({ qaInclusions: "不相关资料目录" });
        instructionAllowed = false;
        return fauxAssistantMessage([fauxToolCall("todo_get", {})], { stopReason: "toolUse" });
      },
      (context) => {
        const system = getCurrentSystemPrompt(context.messages);
        assert.ok(
          !system.includes(second),
          "the independent instruction policy must withdraw project rules at the next real model request"
        );
        assert.ok(system.includes(rootInstruction));
        instructionAllowed = true;
        return fauxAssistantMessage([fauxToolCall("todo_get", {})], { stopReason: "toolUse" });
      },
      (context) => {
        const system = getCurrentSystemPrompt(context.messages);
        assert.ok(
          system.includes(second),
          "QA inclusions and whole-root exclusions cannot veto a permitted instruction source"
        );
        assert.ok(system.includes(rootInstruction));
        return fauxAssistantMessage("项目约定独立于资料检索，真实指令读取限制已核对");
      },
    ]);
    await backend.prompt({
      sessionId,
      requestId: "project-original",
      prompt: [{ type: "text", text: "按项目约定核对资料" }],
    });
    assert.equal(faux.state.callCount, 4);
    await backend.shutdown();
    const wireFirst = "项目独立口令-WIRE-A-71021";
    const wireSecond = "项目独立口令-WIRE-B-92834";
    const wireCases = [
      {
        id: "generic",
        baseUrl: "https://fixture.invalid/v1",
        catalogProviderId: undefined,
        info: { id: "model", toolCall: true, limits: { context: 262144, output: 1024 } },
      },
      ...[undefined, "opencode-go"].map((catalogProviderId) => ({
        id: catalogProviderId ? "go-declared" : "go-url",
        baseUrl: "https://opencode.ai/inference/go/v1",
        catalogProviderId,
        info: {
          id: "deepseek-v4.1-flash",
          toolCall: true,
          reasoning: true,
          reasoningEfforts: ["low", "high", "max"],
          capabilities: { midConversationSystemMessages: false },
          limits: { context: 1_000_000, output: 384_000 },
        },
      })),
      {
        id: "lm-studio",
        baseUrl: "http://localhost:1234/v1",
        catalogProviderId: undefined,
        info: {
          id: "qwen/qwen3.8-27b",
          toolCall: true,
          reasoning: false,
          reasoningEfforts: [],
          capabilities: { midConversationSystemMessages: false },
          limits: { context: 128_000, output: 63_500 },
        },
      },
    ];
    const wireProviders: { id: string; modelId: string; requests: number }[] = [];
    for (const wireCase of wireCases) {
      const wireSettings = {
        ...settings,
        providers: {
          fixture: {
            ...settings.providers.fixture,
            baseUrl: wireCase.baseUrl,
            origin: {
              kind: "byok" as const,
              ...(wireCase.catalogProviderId
                ? { catalogProviderId: wireCase.catalogProviderId }
                : {}),
            },
          },
        },
        configuredModels: [
          {
            ...settings.configuredModels[0],
            info: { ...wireCase.info, displayName: wireCase.info.id },
          },
        ],
      };
      const wireRequests: {
        model: string;
        messages: { role: string; content: unknown }[];
      }[] = [];
      const wireBackend = new PiBackendProcess({
        host: {
          app,
          isVaultPathAllowed: options.host.isVaultPathAllowed,
          getSettings: () => wireSettings,
          privateRoot: path.join(directory, `wire-private-${wireCase.id}`),
          keychain: options.host.keychain,
          fetch: async (input, init) => {
            const request = new Request(input, init);
            assert.equal(
              request.url,
              `${wireCase.baseUrl}/chat/completions`,
              "the production serializer uses this provider's real endpoint while the fixture intercepts all traffic locally"
            );
            const payload = JSON.parse(await request.text()) as (typeof wireRequests)[number];
            assert.ok(Array.isArray(payload.messages));
            assert.equal(payload.model, wireCase.info.id);
            wireRequests.push(payload);
            const current = payload.messages
              .filter((message) => message.role === "system" || message.role === "developer")
              .map((message) => JSON.stringify(message.content))
              .join("\n");
            if (wireRequests.length === 1) {
              assert.ok(current.includes(wireFirst));
              assert.ok(!current.includes(wireSecond));
            } else {
              assert.equal(wireRequests.length, 2);
              assert.ok(current.includes(wireSecond));
              assert.ok(
                !current.includes(wireFirst),
                "the serialized active system/developer payload must replace A with B"
              );
              assert.ok(
                payload.messages
                  .filter((message) => message.role !== "assistant")
                  .every((message) => !JSON.stringify(message.content).includes(wireFirst)),
                "A may survive only as an old assistant answer, never as a system, developer, user, or tool instruction"
              );
              assert.ok(
                payload.messages.some(
                  (message) =>
                    message.role === "assistant" &&
                    JSON.stringify(message.content).includes(wireFirst)
                ),
                "the old assistant answer remains history rather than an active instruction"
              );
            }
            const answer = wireRequests.length === 1 ? wireFirst : wireSecond;
            const chunks = [
              {
                choices: [
                  {
                    index: 0,
                    delta: { role: "assistant", content: answer },
                    finish_reason: null,
                  },
                ],
              },
              {
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
              },
            ];
            return new Response(
              chunks
                .map(
                  (chunk) =>
                    `data: ${JSON.stringify({ id: `wire-${wireCase.id}-${wireRequests.length}`, object: "chat.completion.chunk", created: 1, model: wireCase.info.id, ...chunk })}\n\n`
                )
                .join("") + "data: [DONE]\n\n",
              { headers: { "Content-Type": "text/event-stream" } }
            );
          },
        },
      });
      try {
        await fs.writeFile(instructions, wireFirst);
        await wireBackend.start();
        const sessionId = "root-project-instructions-wire";
        await wireBackend.newSession({ sessionId, cwd: workspaceRoot });
        await wireBackend.prompt({
          sessionId,
          requestId: "wire-original",
          prompt: [{ type: "text", text: "按当前项目约定核对资料" }],
        });
        await fs.writeFile(instructions, wireSecond);
        await wireBackend.prompt({
          sessionId,
          requestId: "wire-updated",
          prompt: [{ type: "text", text: "再按当前项目约定核对一次" }],
        });
        assert.equal(wireRequests.length, 2);
        wireProviders.push({
          id: wireCase.id,
          modelId: wireCase.info.id,
          requests: wireRequests.length,
        });
      } finally {
        await wireBackend.shutdown();
      }
    }
    return {
      status: "passed",
      providerCalls: faux.state.callCount,
      wireProviderCalls: wireProviders.reduce((total, provider) => total + provider.requests, 0),
      wireProviders,
      checks: [
        "app_index_filter_stays_excluded",
        "actual_sdk_reads_small_chinese_scoped_agents",
        "next_request_replaces_changed_project_source",
        "independent_instruction_policy_revokes_instructions",
        "qa_inclusions_and_exclusions_do_not_authorize_instructions",
        "real_provider_serialization_replaces_active_instructions_between_turns",
        "old_assistant_answer_remains_only_in_serialized_history",
      ],
    };
  } finally {
    await backend.shutdown();
    setSettings(priorSettings);
  }
}
