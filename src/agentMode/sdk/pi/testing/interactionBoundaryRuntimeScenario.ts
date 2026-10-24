import { TFile, type App } from "obsidian";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { PermissionDecision, PermissionPrompt } from "@/agentMode/session/types";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runInteractionBoundaryRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  const projectA = path.join(vaultRoot, "projects", "alpha");
  const projectB = path.join(vaultRoot, "projects", "beta");
  await fs.mkdir(projectA, { recursive: true });
  await fs.mkdir(projectB, { recursive: true });
  await fs.writeFile(path.join(projectB, "original.md"), "B original stays unchanged");
  const files = new Map<string, TFile>();
  const writes: string[] = [];
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: (target: string) => files.get(target) ?? null,
      getFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()],
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      create: async (target: string, content: string) => {
        await fs.writeFile(path.join(vaultRoot, target), content, { flag: "wx" });
        writes.push(target);
        const file = Object.assign(new TFile(), {
          path: target,
          extension: "md",
          stat: { size: content.length },
        });
        files.set(target, file);
        return file;
      },
      on: () => ({}),
      offref: () => undefined,
    },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
    workspace: { iterateAllLeaves: () => undefined },
  } as unknown as App;
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
        info: { id: "model", toolCall: true, limits: { context: 200_000, output: 4096 } },
        configuredAt: 1,
      },
    ],
    agentMode: { activeBackend: "pi", backends: {}, skills: { folder: "skills" } },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const faux = fauxProvider();
  const backend = new PiBackendProcess({
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "interaction-boundary",
        getSecretById: (id) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  });
  let releaseApproval: (decision: PermissionDecision) => void = () => undefined;
  try {
    await backend.start();
    const a = await backend.newSession({
      sessionId: "root-project-a",
      cwd: projectA,
      projectId: "project-a",
    });
    let announceApproval!: (prompt: PermissionPrompt) => void;
    const pendingA = new Promise<PermissionPrompt>((resolve) => {
      announceApproval = resolve;
    });
    const permissions: PermissionPrompt[] = [];
    backend.setPermissionPrompter((prompt) => {
      permissions.push(prompt);
      announceApproval(prompt);
      return new Promise<PermissionDecision>((resolve) => {
        releaseApproval = resolve;
      });
    });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("vault_create", {
            path: "projects/alpha/approved.md",
            content: "A approved original target",
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("A original write completed"),
    ]);
    const aWork = backend.prompt({
      sessionId: a.sessionId,
      requestId: "a-write-before-switch",
      prompt: [{ type: "text", text: "在A项目写入，等待原卡片批准" }],
    });
    const originalCard = await Promise.race([
      pendingA,
      aWork.then(() => {
        throw new Error("A write finished without showing its original approval");
      }),
    ]);
    assert.equal(writes.length, 0);
    assert.equal(originalCard.sessionId, a.sessionId);
    assert.equal(originalCard.binding?.toolId, "vault_create");
    assert.deepEqual(originalCard.binding?.targets, ["projects/alpha/approved.md"]);
    assert.ok(JSON.stringify(originalCard.toolCall.content).includes("A approved original target"));
    const cardBeforeSwitch = JSON.stringify({ ...originalCard, signal: undefined });
    const b = await backend.newSession({
      sessionId: "root-project-b",
      cwd: projectB,
      projectId: "project-b",
    });
    backend.setSessionObserved({ sessionId: a.sessionId, observed: false });
    backend.setSessionObserved({ sessionId: b.sessionId, observed: true });
    await backend.loadSession({ sessionId: b.sessionId, cwd: projectB, projectId: "project-b" });
    const bBefore = (await backend.exportSession({ sessionId: b.sessionId, format: "json" }))
      .content;
    assert.equal(JSON.stringify({ ...originalCard, signal: undefined }), cardBeforeSwitch);
    releaseApproval({ outcome: { outcome: "selected", optionId: "allow_once" } });
    await aWork;
    assert.deepEqual(writes, ["projects/alpha/approved.md"]);
    assert.equal(
      await fs.readFile(path.join(projectA, "approved.md"), "utf8"),
      "A approved original target"
    );
    assert.deepEqual(await fs.readdir(projectB), ["original.md"]);
    assert.equal(
      await fs.readFile(path.join(projectB, "original.md"), "utf8"),
      "B original stays unchanged"
    );
    const aExport = JSON.parse(
      (await backend.exportSession({ sessionId: a.sessionId, format: "json" })).content
    ) as { session: { projectId: string; extras: { entries: { kind: string; data: unknown }[] } } };
    const bAfter = JSON.parse(
      (await backend.exportSession({ sessionId: b.sessionId, format: "json" })).content
    ) as { session: { projectId: string; messages: unknown[] } };
    assert.equal(aExport.session.projectId, "project-a");
    assert.equal(bAfter.session.projectId, "project-b");
    assert.deepEqual(
      bAfter.session.messages,
      (JSON.parse(bBefore) as typeof bAfter).session.messages
    );
    assert.equal(permissions.length, 1);
    const savedApproval = aExport.session.extras.entries
      .filter((entry) => entry.kind === "va.approval")
      .map((entry) => entry.data)
      .at(-1);
    assert.ok(JSON.stringify(savedApproval).includes('"sessionId":"root-project-a"'));
    assert.ok(JSON.stringify(savedApproval).includes('"targets":["projects/alpha/approved.md"]'));
    backend.setPermissionPrompter(async (prompt) => {
      permissions.push(prompt);
      throw new Error("B must reject A's scope before showing an approval");
    });
    const callsBeforeWrongScope = faux.state.callCount;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("vault_create", {
            path: "projects/alpha/beta-must-not-write.md",
            content: "forbidden",
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("B cannot use A's old approval or scope"),
    ]);
    await backend.prompt({
      sessionId: b.sessionId,
      requestId: "b-cannot-inherit-a-scope",
      prompt: [{ type: "text", text: "尝试使用A范围" }],
    });
    assert.equal(faux.state.callCount, callsBeforeWrongScope + 2);
    assert.equal(permissions.length, 1);
    assert.deepEqual(writes, ["projects/alpha/approved.md"]);
    assert.equal(
      await fs.stat(path.join(projectA, "beta-must-not-write.md")).then(
        () => true,
        () => false
      ),
      false
    );
    await backend.closeSession({ sessionId: a.sessionId });

    const plan = await backend.newSession({ sessionId: "root-plan-write", cwd: vaultRoot });
    await backend.setSessionMode({ sessionId: plan.sessionId, modeId: "plan" });
    let announceWrite!: (prompt: PermissionPrompt) => void;
    const waitingWrite = new Promise<PermissionPrompt>((resolve) => {
      announceWrite = resolve;
    });
    let planApprovals = 0;
    backend.setPermissionPrompter((prompt) => {
      if (prompt.toolCall.isPlanProposal) {
        planApprovals += 1;
        assert.equal(prompt.sessionId, plan.sessionId);
        assert.equal(
          prompt.options.some((option) => option.optionId === "allow_once"),
          false
        );
        return Promise.resolve({ outcome: { outcome: "selected", optionId: "approve_plan" } });
      }
      announceWrite(prompt);
      return new Promise<PermissionDecision>((resolve) => {
        releaseApproval = resolve;
      });
    });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("propose_plan", {
            title: "独立计划批准",
            body: "先批计划，再独立确认写入",
            steps: ["创建笔记"],
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage(
        [
          fauxToolCall("vault_create", {
            path: "plan-separate-write.md",
            content: "write separately approved",
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("independent plan and file approvals completed"),
    ]);
    const planWork = backend.prompt({
      sessionId: plan.sessionId,
      requestId: "one-prompt-plan-then-write",
      prompt: [{ type: "text", text: "提出计划并按计划写入" }],
    });
    const writeCard = await Promise.race([
      waitingWrite,
      planWork.then(() => {
        throw new Error(
          "Plan approval incorrectly let the file write finish without its own approval"
        );
      }),
    ]);
    assert.equal(planApprovals, 1);
    assert.equal(writeCard.sessionId, plan.sessionId);
    assert.equal(writeCard.binding?.toolId, "vault_create");
    assert.deepEqual(writeCard.binding?.targets, ["plan-separate-write.md"]);
    assert.ok(
      writeCard.toolCall.content?.some(
        (part) => part.type === "diff" && part.newText === "write separately approved"
      )
    );
    assert.equal(
      (await backend.loadSession({ sessionId: plan.sessionId, cwd: vaultRoot })).state.mode
        ?.current,
      "default"
    );
    assert.deepEqual(writes, ["projects/alpha/approved.md"]);
    assert.equal(
      await fs.stat(path.join(vaultRoot, "plan-separate-write.md")).then(
        () => true,
        () => false
      ),
      false
    );
    releaseApproval({ outcome: { outcome: "selected", optionId: "allow_once" } });
    await planWork;
    assert.equal(
      await fs.readFile(path.join(vaultRoot, "plan-separate-write.md"), "utf8"),
      "write separately approved"
    );
    assert.deepEqual(writes, ["projects/alpha/approved.md", "plan-separate-write.md"]);
    return {
      status: "passed",
      checks: [
        "SC-P12-T06-01-switch-project-does-not-write-b",
        "SC-P12-T06-02-old-approval-keeps-original-session-target-and-scope",
        "other-root-cannot-reuse-original-scope-or-decision",
        "SC-P08-T03-01-same-prompt-plan-approval-still-needs-new-file-approval",
      ],
      actualFileWrites: writes,
    };
  } finally {
    releaseApproval({ outcome: { outcome: "cancelled" } });
    await backend.shutdown();
  }
}
