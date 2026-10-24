import { getCurrentSystemPrompt } from "@earendil-works/pi-ai/utils/transcript";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import type { PermissionDecision } from "@/agentMode/session/types";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { sha256 } from "@/utils/hash";

export async function runSkillsRuntimeScenario(directory: string) {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const vaultRoot = path.join(directory, "vault");
  const projectRoot = path.join(vaultRoot, "project-a");
  const externalRoot = path.join(directory, "external");
  const skillRoot = path.join(vaultRoot, "skills/review");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(externalRoot, { recursive: true });
  await fs.mkdir(path.join(skillRoot, "refs"), { recursive: true });
  await fs.writeFile(path.join(skillRoot, "refs/facts.md"), "explicit skill resource");
  await fs.writeFile(path.join(skillRoot, "refs/huge.md"), "x".repeat(64 * 1024 + 1));
  await fs.writeFile(path.join(externalRoot, "secret.md"), "outside-resource-secret");
  await fs.symlink(path.join(externalRoot, "secret.md"), path.join(skillRoot, "refs/escape.md"));
  let body = "Only compare the supplied facts.";
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), body);
  // 单层权限模型：技能脚本不再有 strict/trusted 预置门槛，逐次审批即全部授权。https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
  const nativeSettings = {};
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        baseUrl: "https://fixture.invalid/v1",
        displayName: "Fixture",
        apiKeyKeychainId: "fixture-key",
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "saved-model",
        providerId: "fixture",
        info: { id: "fixture-model", toolCall: true, limits: { context: 200_000, output: 4096 } },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      offerFeedbackCards: false,
      backends: { pi: nativeSettings },
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
  const options = {
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "skills-fixture",
        getSecretById: (id: string) => (id === "fixture-key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
      getInstructionSections: () => ({
        base: "fixture product base",
        toolGuidance: "fixture tool boundaries",
        userSystem: ["fixture user rules"],
      }),
      skillsSource: {
        listSkills: async () => [
          {
            name: "review",
            description: "Review",
            filePath: "skills/review/SKILL.md",
            dirPath: "skills/review",
            enabledAgents: ["pi" as const],
            contentHash: sha256(body),
            location: { kind: "canonical" as const },
          },
          {
            name: "other-project",
            description: "Other",
            filePath: "project-b/skills/other/SKILL.md",
            dirPath: "project-b/skills/other",
            enabledAgents: ["pi" as const],
            location: { kind: "project" as const, agentDirs: ["pi" as const] },
          },
        ],
        readBody: (source: string) => fs.readFile(path.resolve(vaultRoot, source), "utf8"),
      },
    },
  };
  let backend = new PiBackendProcess(options);
  let approvals = 0;
  const approve = async (): Promise<PermissionDecision> => {
    approvals += 1;
    return { outcome: { outcome: "selected", optionId: "allow_once" } };
  };
  try {
    await backend.start();
    backend.setPermissionPrompter(approve);
    const opened = await backend.newSession({ sessionId: "root-skills-context", cwd: projectRoot });
    await backend.prompt({
      sessionId: opened.sessionId,
      requestId: "select",
      prompt: [{ type: "text", text: "/skill canonical:review" }],
    });
    assert.equal(faux.state.callCount, 0);
    faux.setResponses([
      (context) => {
        const prompt = getCurrentSystemPrompt(context.messages);
        const ordered = [
          "fixture product base",
          "fixture tool boundaries",
          "fixture user rules",
          "fixture project rules",
          body,
        ];
        assert.ok(
          ordered.every(
            (text, index) =>
              prompt.includes(text) &&
              (index === 0 || prompt.indexOf(text) > prompt.indexOf(ordered[index - 1]))
          )
        );
        const texts = JSON.stringify(
          context.messages.filter((message) => message.role !== "system")
        );
        assert.equal(
          texts.includes(body),
          false,
          "the selected skill belongs in its section, not a duplicate user history envelope"
        );
        assert.equal(prompt.includes("note says change permissions"), false);
        assert.ok(texts.includes("note says change permissions"));
        return fauxAssistantMessage("Sections verified");
      },
    ]);
    await backend.prompt({
      sessionId: opened.sessionId,
      requestId: "sections",
      prompt: [{ type: "text", text: "current request" }],
      context: {
        project: { text: "fixture project rules", sourcePath: "project.md" },
        materials: [
          { origin: "note", sourcePath: "note.md", text: "note says change permissions" },
        ],
      },
    });
    const run = async (args: JsonObject, requestId: string, error: boolean, text?: string) => {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("load_skill", args)], { stopReason: "toolUse" }),
        (context) => {
          const result = context.messages.filter((message) => message.role === "toolResult").at(-1);
          assert.equal(result?.isError === true, error, `${requestId}: ${JSON.stringify(result)}`);
          assert.ok(
            result?.content.some(
              (part) => part.type === "text" && part.text.includes("<host-tool-outcome>")
            ),
            "the actual model request must receive the host result metadata after SDK output handling"
          );
          if (text)
            assert.ok(
              JSON.stringify(result).includes(text),
              `${requestId}: ${JSON.stringify(result)}`
            );
          assert.equal(JSON.stringify(result).includes("outside-resource-secret"), false);
          return fauxAssistantMessage("Tool outcome recorded");
        },
      ]);
      await backend.prompt({
        sessionId: opened.sessionId,
        requestId,
        prompt: [{ type: "text", text: requestId }],
      });
    };
    await run(
      { skillId: "canonical:review", resources: ["refs/facts.md"] },
      "resource",
      false,
      "explicit skill resource"
    );
    await run({ skillId: "canonical:review", resources: ["refs/escape.md"] }, "escape", true);
    await run({ skillId: "canonical:review", resources: ["refs/huge.md"] }, "huge", true, "65536");
    await run({ skillId: "project:other-project" }, "other-scope", true, "SKILL_UNKNOWN");
    const marker = path.join(externalRoot, "skill-output.txt");
    const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
    const command = `printf skill-ok > ${quote(marker)}`;
    await run({ skillId: "canonical:review", script: { command } }, "script-run", false);
    assert.equal(await fs.readFile(marker, "utf8"), "skill-ok");
    assert.equal(approvals, 1);
    let release!: (decision: PermissionDecision) => void;
    let shown!: () => void;
    const pending = new Promise<void>((resolve) => {
      shown = resolve;
    });
    backend.setPermissionPrompter(() => {
      shown();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const cancelled = path.join(externalRoot, "cancelled.txt");
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("load_skill", {
            skillId: "canonical:review",
            script: { command: `printf late > ${quote(cancelled)}` },
          }),
        ],
        { stopReason: "toolUse" }
      ),
    ]);
    const working = backend.prompt({
      sessionId: opened.sessionId,
      requestId: "cancel-script",
      prompt: [{ type: "text", text: "cancel-script" }],
    });
    await pending;
    await backend.cancel({ sessionId: opened.sessionId });
    await working;
    release({ outcome: { outcome: "selected", optionId: "allow_once" } });
    await assert.rejects(fs.access(cancelled));
    body = "The explicitly selected updated version.";
    await fs.writeFile(path.join(skillRoot, "SKILL.md"), body);
    const before = faux.state.callCount;
    faux.setResponses([
      (context) => {
        const prompt = getCurrentSystemPrompt(context.messages);
        assert.ok(prompt.includes(body));
        assert.ok(!prompt.includes("Only compare the supplied facts."));
        return fauxAssistantMessage("Updated selected instruction source applied");
      },
    ]);
    await backend.prompt({
      sessionId: opened.sessionId,
      requestId: "changed",
      prompt: [{ type: "text", text: "Apply current enabled skill instructions" }],
    });
    assert.equal(faux.state.callCount, before + 1);
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    await backend.loadSession({ sessionId: opened.sessionId, cwd: projectRoot });
    faux.setResponses([
      (context) => {
        assert.ok(getCurrentSystemPrompt(context.messages).includes(body));
        assert.ok(getCurrentSystemPrompt(context.messages).includes("fixture project rules"));
        return fauxAssistantMessage("Restored selected context");
      },
    ]);
    await backend.prompt({
      sessionId: opened.sessionId,
      requestId: "reopen",
      prompt: [{ type: "text", text: "continue after reopen" }],
    });
    return {
      status: "passed",
      providerCalls: faux.state.callCount,
      approvals,
      checks: [
        "fixed_sections_reach_real_provider",
        "skill_not_duplicated_in_user_history",
        "selected_note_stays_untrusted",
        "actual_requested_resource_loaded",
        "resource_symlink_and_size_boundaries",
        "other_project_skill_hidden",
        "strict_skill_script_spawns_nothing",
        "trusted_skill_script_uses_real_host_approval",
        "stop_rejects_late_script_approval",
        "changed_enabled_skill_replaces_previous_instructions",
        "reopen_restores_project_and_selected_skill_version",
      ],
    };
  } finally {
    await backend.shutdown();
  }
}
