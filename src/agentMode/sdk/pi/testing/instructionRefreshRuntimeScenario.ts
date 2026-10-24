import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { withDiagnosticSummaries } from "./diagnosticSummaryProvider";

export async function runInstructionRefreshRuntimeScenario(directory: string) {
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
  const app = {
    vault: {
      configDir: ".fixture",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [],
      getMarkdownFiles: () => [],
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const faux = fauxProvider();
  const options = {
    host: {
      app,
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => withDiagnosticSummaries(faux.provider),
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "work-continuation",
        getSecretById: (id: string) => (id === "fixture-key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
    },
  };
  let custom = "CUSTOM_VERSION_ONE";
  let skillBody = "SKILL_VERSION_ONE";
  let enabled = true;
  let project = "PROJECT_VERSION_ONE";
  Object.assign(options.host, {
    getInstructionSections: () => ({
      base: "PRODUCT_RULE",
      toolGuidance: "TOOL_POLICY",
      userSystem: [custom],
    }),
    getProjectContext: () => ({ text: project }),
    skillsSource: {
      listSkills: async () => [
        {
          name: "review",
          description: "Review",
          filePath: "skills/review/SKILL.md",
          dirPath: "skills/review",
          body: skillBody,
          enabledAgents: enabled ? ["pi"] : [],
          location: { kind: "canonical" },
        },
      ],
      readBody: async () => skillBody,
    },
  });
  const sessionId = "root-instruction-refresh";
  const backend = new PiBackendProcess(options);
  const instructions = path.join(vaultRoot, "AGENTS.md");
  await fs.writeFile(instructions, "AGENTS_VERSION_ONE");
  const { getCurrentSystemPrompt } = await import("@earendil-works/pi-ai/utils/transcript");
  try {
    await backend.start();
    await backend.newSession({ sessionId, cwd: vaultRoot, projectId: "project" });
    await backend.prompt({
      sessionId,
      requestId: "select",
      prompt: [{ type: "text", text: "/skill canonical:review" }],
    });
    faux.setResponses([
      async (context) => {
        const text = getCurrentSystemPrompt(context.messages);
        assert.ok(text.includes("AGENTS_VERSION_ONE"));
        assert.ok(text.includes("CUSTOM_VERSION_ONE"));
        assert.ok(text.includes("SKILL_VERSION_ONE"));
        await fs.writeFile(instructions, "AGENTS_VERSION_TWO");
        custom = "CUSTOM_VERSION_TWO";
        skillBody = "SKILL_VERSION_TWO";
        project = "PROJECT_VERSION_TWO";
        return fauxAssistantMessage([fauxToolCall("todo_get", {})], { stopReason: "toolUse" });
      },
      async (context) => {
        const text = getCurrentSystemPrompt(context.messages);
        assert.ok(
          text.includes("AGENTS_VERSION_TWO"),
          "next model step must read the changed AGENTS source"
        );
        assert.ok(!text.includes("AGENTS_VERSION_ONE"));
        assert.ok(text.includes("CUSTOM_VERSION_TWO"));
        assert.ok(!text.includes("CUSTOM_VERSION_ONE"));
        assert.ok(text.includes("SKILL_VERSION_TWO"));
        assert.ok(!text.includes("SKILL_VERSION_ONE"));
        assert.ok(text.includes("PROJECT_VERSION_TWO"));
        await fs.rm(instructions);
        enabled = false;
        return fauxAssistantMessage([fauxToolCall("todo_get", {})], { stopReason: "toolUse" });
      },
      (context) => {
        const text = getCurrentSystemPrompt(context.messages);
        assert.ok(!text.includes("AGENTS_VERSION_TWO"));
        assert.ok(!text.includes("SKILL_VERSION_TWO"));
        assert.ok(text.includes("CUSTOM_VERSION_TWO"));
        return fauxAssistantMessage("Refreshed instruction sources");
      },
    ]);
    await backend.prompt({
      sessionId,
      requestId: "refresh",
      prompt: [{ type: "text", text: "Continue while source rules change" }],
    });
    assert.equal(faux.state.callCount, 3);
    await fs.writeFile(instructions, "CHILD_AGENTS_ONE");
    faux.appendResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("delegate_task", {
            profileId: "reviewer",
            task: "Review the given material",
            description: "Instruction refresh reviewer",
            inputFiles: [],
          }),
        ],
        { stopReason: "toolUse" }
      ),
      async (context) => {
        const text = getCurrentSystemPrompt(context.messages);
        assert.equal(
          JSON.stringify(context.messages).includes("PARENT_ONLY_REQUEST_MARKER"),
          false,
          "child must not inherit the parent's raw goal or request through the shared work checkpoint"
        );
        assert.ok(
          text.includes(
            "Review the given material and report concrete problems. Never modify the vault."
          )
        );
        assert.ok(text.includes('"profileId":"reviewer"'));
        assert.ok(text.includes('"readOnly":true'));
        assert.ok(text.includes('"outputPaths":[]'));
        assert.ok(text.includes("CHILD_AGENTS_ONE"));
        await fs.writeFile(instructions, "CHILD_AGENTS_TWO");
        custom = "CHILD_CUSTOM_TWO";
        return fauxAssistantMessage([fauxToolCall("vault_search", { query: "no-match" })], {
          stopReason: "toolUse",
        });
      },
      (context) => {
        const text = getCurrentSystemPrompt(context.messages);
        assert.ok(text.includes("CHILD_AGENTS_TWO"));
        assert.equal(
          JSON.stringify(context.messages).includes("PARENT_ONLY_REQUEST_MARKER"),
          false
        );
        assert.ok(!text.includes("CHILD_AGENTS_ONE"));
        assert.ok(text.includes("CHILD_CUSTOM_TWO"));
        assert.ok(
          text.includes(
            "Review the given material and report concrete problems. Never modify the vault."
          )
        );
        assert.ok(text.includes('"outputPaths":[]'));
        return fauxAssistantMessage("Child role survived instruction refresh");
      },
      fauxAssistantMessage("Delegation completed with refreshed sources"),
    ]);
    await backend.prompt({
      sessionId,
      requestId: "child-refresh",
      prompt: [{ type: "text", text: "Delegate a read-only review. PARENT_ONLY_REQUEST_MARKER" }],
    });
    assert.equal(faux.state.callCount, 7);
    return {
      status: "passed",
      checks: [
        "next_step_replaces_AGENTS_custom_project_skill_versions",
        "deleted_AGENTS_and_disabled_skill_are_removed",
        "one_autonomous_segment_no_duplicate_user_input",
        "child_profile_readonly_and_output_boundaries_survive_dynamic_instruction_refresh",
      ],
    };
  } finally {
    await backend.shutdown();
  }
}
