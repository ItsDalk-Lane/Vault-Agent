import { requireNodeModule } from "@/utils/desktopRuntime";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { App } from "obsidian";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type { PermissionDecision } from "@/agentMode/session/types";

export async function runNativeRuntimeScenario(directory: string) {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const assert: typeof import("node:assert/strict") =
    requireNodeModule<typeof import("node:assert/strict")>("node:assert/strict");
  const vaultRoot = path.join(directory, "vault"),
    externalRoot = path.join(directory, "external");
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.mkdir(externalRoot, { recursive: true });
  const target = path.join(externalRoot, "note.md");
  await fs.writeFile(target, "before");
  const backendSettings = {
    hostExecutionMode: "strict" as "strict" | "trusted_host",
    externalScopes: [{ root: externalRoot, permissions: ["read", "write"] }],
  };
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
        configuredModelId: "fixture-model",
        providerId: "fixture",
        info: {
          id: "fixture-model",
          displayName: "Fixture",
          toolCall: true,
          limits: { context: 200_000, output: 4096 },
        },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: { pi: backendSettings },
    },
    backends: { pi: { enabledModels: ["fixture-model"] } },
  } as unknown as VaultAgentSettings;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [],
      getMarkdownFiles: () => [],
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const provider = fauxProvider();
  const backend = new PiBackendProcess({
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "native-fixture",
        getSecretById: (id) => (id === "fixture-key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => provider.provider,
    },
  });
  try {
    await backend.start();
    const session = await backend.newSession({ cwd: vaultRoot });
    await backend.setSessionModel({ sessionId: session.sessionId, modelId: "fixture-model" });
    let approvals = 0;
    backend.setPermissionPrompter(async (request) => {
      approvals++;
      if (request.toolCall.kind === "edit")
        assert.ok(JSON.stringify(request.toolCall).includes("after"));
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    });
    const run = async (name: string, args: JsonObject, requestId: string) => {
      provider.setResponses([
        fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
        fauxAssistantMessage("done"),
      ]);
      return backend.prompt({
        sessionId: session.sessionId,
        requestId,
        prompt: [{ type: "text", text: name }],
      });
    };
    await run("write", { path: target, content: "after" }, "write");
    assert.equal(await fs.readFile(target, "utf8"), "after");
    assert.equal(approvals, 1);
    await backend.setSessionMode({ sessionId: session.sessionId, modeId: "plan" });
    await run("write", { path: target, content: "forbidden" }, "plan");
    assert.equal(await fs.readFile(target, "utf8"), "after");
    assert.equal(approvals, 1);
    await backend.setSessionMode({ sessionId: session.sessionId, modeId: "default" });
    const marker = path.join(externalRoot, "command.txt");
    await run("bash", { command: `printf command > "${marker}"` }, "strict");
    assert.equal(
      await fs.access(marker).then(
        () => true,
        () => false
      ),
      false
    );
    assert.equal(approvals, 1);
    backendSettings.hostExecutionMode = "trusted_host";
    await run("bash", { command: `printf command > "${marker}"`, timeout: 2 }, "trusted");
    assert.equal(await fs.readFile(marker, "utf8"), "command");
    assert.equal(approvals, 2);
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    let approve!: (value: PermissionDecision) => void;
    backend.setPermissionPrompter(async () => {
      started();
      return new Promise((resolve) => {
        approve = resolve;
      });
    });
    const writing = run("write", { path: target, content: "late" }, "cancel");
    await pending;
    await backend.cancel({ sessionId: session.sessionId });
    await writing;
    approve({ outcome: { outcome: "selected", optionId: "allow_once" } });
    assert.equal(await fs.readFile(target, "utf8"), "after");
    const exported = await backend.exportSession({ sessionId: session.sessionId, format: "json" });
    const saved = JSON.parse(exported.content) as {
      session: {
        extras: {
          entries: {
            kind: string;
            model?: readonly {
              readonly role: string;
              readonly toolName?: string;
              readonly isError?: boolean;
            }[];
            data?: { toolId: string; decision: string; status: string; argumentsHash: string };
          }[];
        };
      };
    };
    const audits = saved.session.extras.entries
      .filter((entry) => entry.kind === "va.audit")
      .map((entry) => entry.data!);
    assert.ok(audits.some((record) => record.toolId === "write" && record.status === "executed"));
    assert.ok(audits.some((record) => record.toolId === "bash" && record.status === "executed"));
    assert.ok(audits.some((record) => record.toolId === "write" && record.status === "cancelled"));
    assert.ok(audits.every((record) => /^[a-f0-9]{64}$/.test(record.argumentsHash)));
    assert.equal(JSON.stringify(audits).includes("printf command"), false);
    assert.equal(JSON.stringify(audits).includes("test-key"), false);
    // 未提供给模型的命令在 SDK 层就拒绝；仍必须保留真实错误证据，不能伪造执行器已被调用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    assert.ok(
      saved.session.extras.entries.some(
        (entry) =>
          entry.kind === "pi.tool-result" &&
          entry.model?.some(
            (message) =>
              message.role === "toolResult" &&
              message.toolName === "bash" &&
              message.isError === true
          )
      ),
      "strict mode must persist the SDK command rejection alongside proof that no process ran"
    );
    backend.setPermissionPrompter(async () => {
      approvals += 1;
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    });
    const faultTarget = path.join(await fs.realpath(externalRoot), "audit-once.md");
    const appendFile = fs.appendFile;
    const writeFile = fs.writeFile;
    let effectWrites = 0;
    let auditFailures = 0;
    fs.writeFile = async (file, data, writeOptions) => {
      await writeFile(file, data, writeOptions);
      if (typeof file === "string" && file === faultTarget) effectWrites += 1;
    };
    fs.appendFile = async (file, data, appendOptions) => {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      if (effectWrites && text.includes('"va.audit"') && text.includes('"executed"')) {
        auditFailures += 1;
        throw Object.assign(new Error("injected durable audit failure after native effect"), {
          code: "EIO",
        });
      }
      await appendFile(file, data, appendOptions);
    };
    const beforeFault = provider.state.callCount;
    try {
      const result = await run(
        "write",
        { path: faultTarget, content: "keep exactly one effect" },
        "audit-fault"
      ).then(
        (value) => value,
        () => null
      );
      assert.notEqual(result?.stopReason, "end_turn");
      assert.ok(
        auditFailures > 0,
        "the actual private JSONL audit append must fail after the effect"
      );
      assert.equal(effectWrites, 1);
      assert.equal(await fs.readFile(faultTarget, "utf8"), "keep exactly one effect");
      assert.equal(
        provider.state.callCount,
        beforeFault + 1,
        "audit failure must stop the next actual provider request"
      );
    } finally {
      fs.appendFile = appendFile;
      fs.writeFile = writeFile;
    }
    const failedState = await backend.loadSession({ sessionId: session.sessionId, cwd: vaultRoot });
    assert.equal(failedState.state.readOnly, true);
    const afterFault = provider.state.callCount;
    const backup = await backend.exportSession({ sessionId: session.sessionId, format: "json" });
    assert.ok(backup.content.includes("va.audit"));
    assert.equal(provider.state.callCount, afterFault);
    await backend.shutdown();
    return {
      status: "passed",
      checks: [
        "official_external_write_via_production_backend",
        "concrete_diff_permission",
        "plan_denies_external_write",
        "strict_spawns_nothing",
        "strict_command_rejection_is_persisted_by_the_sdk",
        "trusted_single_approval_runs_supervised_process",
        "stop_pending_write_blocks_late_permission",
        "private_durable_audit_records_effects_and_cancellation_without_arguments_or_secrets",
        "actual_audit_storage_failure_stops_runtime_after_one_effect_and_keeps_read_only_export",
      ],
      approvals,
      auditFailure: {
        effectWrites,
        modelRequests: provider.state.callCount - beforeFault,
        injectedFailures: auditFailures,
        readOnlyExport: failedState.state.readOnly,
      },
    };
  } finally {
    await backend.shutdown();
  }
}
