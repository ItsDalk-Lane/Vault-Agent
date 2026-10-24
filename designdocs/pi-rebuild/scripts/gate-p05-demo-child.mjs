import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  defineToolManifest,
  type ToolEffect,
  type ToolFamily,
} from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";
import { PlatformPathPolicy, PlatformPathError } from "@/agentMode/sdk/pi/policy/PlatformPathPolicy";
import { PolicyEngine, type PolicyRule } from "@/agentMode/sdk/pi/policy/PolicyEngine";
import {
  ApprovalStore,
  type ApprovalPersistence,
  type ApprovalState,
  type ApprovalBindingInput,
} from "@/agentMode/sdk/pi/policy/ApprovalStore";
import { PermissionBridge } from "@/agentMode/sdk/pi/policy/PermissionBridge";
import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";
import { AuditLog, toSafeError, type AuditRecord } from "@/agentMode/sdk/pi/policy/AuditLog";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import type { PermissionPrompt, SessionId } from "@/agentMode/session/types";

// GATE-P05 child: drives the real policy/approval/gateway modules over a fake host to prove the
// policy matrix, one-time binding, fail-closed recovery, path and mode bypass rejection, nested
// execution gate and redacted audit:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const SECRET = "sk-gate-secret-123456";

interface Report {
  result: string;
  policy: { fixtures: number; matched: boolean; denyBeatsAllow: boolean };
  path: {
    vaultEscapeRejected: boolean;
    lookalikeRejected: boolean;
    symlinkBackRejected: boolean;
    windowsAdsRejected: boolean;
    linuxCaseSensitive: boolean;
  };
  binding: {
    staleOnArgumentChange: boolean;
    consumedOnce: boolean;
    secondConsumeRejected: boolean;
  };
  approval: {
    noPrompterUnavailable: boolean;
    restartPendingNotAllowed: boolean;
    expiredRejected: boolean;
    rejectNoEffect: boolean;
  };
  gateway: {
    nestedDenied: boolean;
    hiddenDenied: boolean;
    unwrappedDenied: boolean;
    wrapperNotReplaceable: boolean;
  };
  audit: {
    secretRedacted: boolean;
    headerNotPersisted: boolean;
    denialNotSuccess: boolean;
    safeErrorCode: string;
    safeErrorSuggestedTool: string;
  };
  durationMs: number;
}

function definition(
  toolId: string,
  family: ToolFamily,
  effects: readonly ToolEffect[]
) {
  return defineToolManifest({
    toolId,
    family,
    effects,
    parameters: { type: "object" },
    extractTargets: () => [],
    implementationVersion: 1,
    schemaVersion: 1,
    replayPolicy: "idempotent",
    allowedCallers: ["root", "subagent"],
    maxOutputBytes: 64_000,
  });
}

const VAULT_TARGET = { kind: "vault_path" as const, value: "/vault/Notes/a.md", insideScope: true };
const EXTERNAL_TARGET = {
  kind: "external_path" as const,
  value: "/ext/a.md",
  insideScope: true,
};

function policyRequest(
  manifest: ReturnType<typeof definition>,
  mode: "plan" | "default" | "auto",
  overrides: Record<string, unknown> = {}
) {
  return {
    manifest,
    targets: [VAULT_TARGET],
    mode,
    caller: "root" as const,
    scope: { vaultRoot: "/vault", externalRoots: [] as string[], readOnly: false },
    rules: [] as readonly PolicyRule[],
    ...overrides,
  };
}

class MemoryPersistence implements ApprovalPersistence {
  state: ApprovalState | null = null;
  async load(): Promise<ApprovalState | null> {
    return this.state;
  }
  async save(state: ApprovalState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state)) as ApprovalState;
  }
}

function binding(overrides: Partial<ApprovalBindingInput> = {}): ApprovalBindingInput {
  return {
    approvalId: "approval-1",
    toolId: "vault_write",
    schemaHash: "schema-1",
    arguments: { path: "Notes/a.md", text: "new" },
    targets: ["/vault/Notes/a.md"],
    beforeHash: "before-1",
    scopeVersion: 1,
    policyVersion: 1,
    ...overrides,
  };
}

function snapshotOf(input: ApprovalBindingInput) {
  return {
    schemaHash: input.schemaHash,
    arguments: input.arguments,
    targets: input.targets,
    beforeHash: input.beforeHash,
    scopeVersion: input.scopeVersion,
    policyVersion: input.policyVersion,
  };
}

async function errorCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const policyEngine = new PolicyEngine();
  const fixtures: Array<{ request: ReturnType<typeof policyRequest>; expected: unknown }> = [
    {
      request: policyRequest(definition("vault_read", "vault", ["read"]), "plan"),
      expected: { decision: "allow", requiresApproval: false },
    },
    {
      request: policyRequest(definition("vault_write", "vault", ["write"]), "plan"),
      expected: { decision: "deny", code: "READ_ONLY_MODE" },
    },
    {
      request: policyRequest(definition("vault_write", "vault", ["write"]), "default"),
      expected: { decision: "allow", requiresApproval: true },
    },
    {
      request: policyRequest(definition("vault_write", "vault", ["write"]), "auto"),
      expected: { decision: "allow", requiresApproval: false },
    },
    {
      request: policyRequest(definition("vault_delete", "vault", ["delete"]), "auto"),
      expected: { decision: "allow", requiresApproval: true },
    },
    {
      request: policyRequest(definition("native_read", "native_file", ["read"]), "default"),
      expected: { decision: "deny", code: "USE_VAULT_TOOL", suggestedTool: "vault_read" },
    },
    {
      request: policyRequest(definition("mcp_tool", "mcp", ["network"]), "plan"),
      expected: { decision: "deny", code: "PERMISSION_DENIED" },
    },
    {
      request: policyRequest(definition("external_read", "native_file", ["read"]), "plan", {
        targets: [EXTERNAL_TARGET],
        scope: { vaultRoot: "/vault", externalRoots: ["/ext"], readOnly: false },
      }),
      expected: { decision: "allow", requiresApproval: false },
    },
    {
      request: policyRequest(definition("control_state", "control", ["state"]), "plan"),
      expected: { decision: "allow", requiresApproval: false },
    },
  ];
  const matched = fixtures.every((fixture) => {
    const outcome = policyEngine.decide(fixture.request);
    return Object.entries(fixture.expected as Record<string, unknown>).every(
      ([key, value]) => (outcome as unknown as Record<string, unknown>)[key] === value
    );
  });
  const allowRule: PolicyRule = { id: "allow", decision: "allow", toolId: "vault_write", effect: "write" };
  const denyRule: PolicyRule = { id: "deny", decision: "deny", toolId: "vault_write", effect: "write" };
  const denyBeatsAllow =
    policyEngine.decide({
      ...policyRequest(definition("vault_write", "vault", ["write"]), "default"),
      rules: [allowRule, denyRule],
    }).decision === "deny";

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gate-p05-"));
  const vault = path.join(root, "vault");
  const vault2 = path.join(root, "vault2");
  const external = path.join(root, "external");
  await fs.mkdir(vault, { recursive: true });
  await fs.mkdir(vault2, { recursive: true });
  await fs.mkdir(external, { recursive: true });
  await fs.writeFile(path.join(vault, "note.md"), "vault");
  await fs.symlink(vault, path.join(external, "vault-link"));
  const resolver = new PathResolver({
    vaultRoot: vault,
    fileSystem: fs,
    path,
    platformPolicy: new PlatformPathPolicy({ platform: "posix", caseSensitivity: "sensitive" }),
  });
  const vaultEscapeRejected =
    (await errorCode(() => resolver.resolveVaultPath("../vault2/note.md"))) === "PATH_OUT_OF_SCOPE";
  const lookalikeRejected =
    (await errorCode(() =>
      resolver.resolveExternalPath(path.join(vault2, "note.md"), vault)
    )) === "PATH_OUT_OF_SCOPE";
  const symlinkBackRejected =
    (await errorCode(() => resolver.resolveExternalPath("vault-link/note.md", external))) ===
    "PATH_OUT_OF_SCOPE";
  const windows = new PlatformPathPolicy({ platform: "win32" });
  const windowsAdsRejected =
    windows.validate("C:\\vault\\note.md") === "C:\\vault\\note.md" &&
    (() => {
      try {
        windows.validate("C:\\vault\\note.md:secret");
        return false;
      } catch (error) {
        return (error as PlatformPathError).code === "INVALID_ARGUMENT";
      }
    })();
  const linux = new PlatformPathPolicy({ platform: "posix", caseSensitivity: "sensitive" });
  const linuxCaseSensitive = !linux.isSamePath("/vault/Note.md", "/vault/note.md");
  await fs.rm(root, { recursive: true, force: true });

  const persistence = new MemoryPersistence();
  const store = new ApprovalStore({ now: () => 1_000, persistence });
  const request = await store.createRequest(binding(), [
    { optionId: "allow-once", kind: "allow_once" },
    { optionId: "reject", kind: "reject_once" },
  ]);
  await store.decide(request, "allow-once");
  const staleOnArgumentChange =
    store.status("approval-1", snapshotOf(binding({ arguments: { path: "evil.md" } }))) === "stale";
  const changedConsumeCode = await errorCode(() =>
    store.consumeOnce("approval-1", snapshotOf(binding({ arguments: { path: "evil.md" } })), "intent-x")
  );
  await store.consumeOnce("approval-1", snapshotOf(binding()), "intent-1");
  const secondConsumeRejected =
    (await errorCode(() =>
      store.consumeOnce("approval-1", snapshotOf(binding()), "intent-2")
    )) === "APPROVAL_CONSUMED";
  const consumedOnce = changedConsumeCode === "APPROVAL_STALE" && store.status("approval-1", snapshotOf(binding())) === "consumed";

  const prompt: PermissionPrompt = {
    sessionId: "session-1" as SessionId,
    toolCall: { toolCallId: "tool-1", title: "Write", kind: "other" },
    options: [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ],
  };
  const unavailableStore = new ApprovalStore({ now: () => 1_000 });
  const bridgeNoPrompter = new PermissionBridge({ store: unavailableStore });
  bridgeNoPrompter.register({
    requestId: "request-1",
    prompt,
    bindingInput: binding({ approvalId: "approval-2" }),
    intentId: "intent-1",
  });
  const noPrompterUnavailable =
    (await bridgeNoPrompter.requestDecision("request-1")).status === "unavailable";

  const pendingPersistence = new MemoryPersistence();
  const pendingStore = new ApprovalStore({ now: () => 1_000, persistence: pendingPersistence });
  await pendingStore.createRequest(binding({ approvalId: "approval-pending" }), [
    { optionId: "allow-once", kind: "allow_once" },
  ]);
  const restarted = new ApprovalStore({ now: () => 2_000, persistence: pendingPersistence });
  await restarted.load();
  const restartPendingNotAllowed =
    restarted.status("approval-pending", snapshotOf(binding())) !== "allowed";

  let expiredNow = 1_000;
  const expiredStore = new ApprovalStore({ now: () => expiredNow });
  const expiredRequest = await expiredStore.createRequest(binding({ approvalId: "approval-exp" }), [
    { optionId: "allow-once", kind: "allow_once" },
  ]);
  await expiredStore.decide(expiredRequest, "allow-once");
  expiredNow = 1_000 + 10 * 60 * 1_000 + 1;
  const expiredRejected =
    expiredStore.status("approval-exp", snapshotOf(binding())) === "expired" &&
    (await errorCode(() =>
      expiredStore.consumeOnce("approval-exp", snapshotOf(binding()), "intent-e")
    )) === "APPROVAL_EXPIRED";

  const rejectStore = new ApprovalStore({ now: () => 1_000 });
  const rejectRequest = await rejectStore.createRequest(binding({ approvalId: "approval-rej" }), [
    { optionId: "reject", kind: "reject_once" },
  ]);
  await rejectStore.decide(rejectRequest, "reject");
  const rejectNoEffect =
    rejectStore.status("approval-rej", snapshotOf(binding())) === "rejected" &&
    (await errorCode(() =>
      rejectStore.consumeOnce("approval-rej", snapshotOf(binding()), "intent-r")
    )) === "APPROVAL_REJECTED";

  const registry = new ToolRegistry();
  const executed: string[] = [];
  const gateway = new ToolGateway({
    registry,
    policy: policyEngine,
    requestApproval: async () => "approved",
    isScopeActive: () => true,
    revalidateTargets: async () => true,
  });
  const outerManifest = definition("outer_tool", "vault", ["read"]);
  const innerManifest = definition("inner_write", "vault", ["write"]);
  registry.register(outerManifest, "host");
  registry.register(innerManifest, "host");
  gateway.registerTool({
    toolId: "inner_write",
    manifest: innerManifest,
    execute: async () => {
      executed.push("inner");
      return { content: "inner" };
    },
  });
  gateway.registerTool({
    toolId: "outer_tool",
    manifest: outerManifest,
    execute: async (_args, ctx) => {
      const nested = await ctx.invokeTool("inner_write", {}, {});
      return { content: JSON.stringify(nested) };
    },
  });
  gateway.setToolEnabled("inner_write", false);
  const outerResult = await gateway.executeTool("outer_tool", {}, {
    caller: "root",
    mode: "default",
    scope: { vaultRoot: "/vault", externalRoots: [], readOnly: false },
    scopeVersion: 1,
    policyVersion: 1,
    targets: [VAULT_TARGET],
  });
  const nestedDenied =
    outerResult.decision === "allow" &&
    outerResult.content.includes("TOOL_DISABLED") &&
    executed.length === 0;
  const hiddenDenied =
    (await gateway.executeTool("inner_write", {}, {
      caller: "root",
      mode: "default",
      scope: { vaultRoot: "/vault", externalRoots: [], readOnly: false },
      scopeVersion: 1,
      policyVersion: 1,
      targets: [VAULT_TARGET],
    })).decision === "deny";
  const unwrappedDenied =
    (await gateway.executeTool("not_registered", {}, {
      caller: "root",
      mode: "default",
      scope: { vaultRoot: "/vault", externalRoots: [], readOnly: false },
      scopeVersion: 1,
      policyVersion: 1,
      targets: [VAULT_TARGET],
    })).decision === "deny";
  let wrapperNotReplaceable = false;
  try {
    gateway.registerTool({ toolId: "inner_write", manifest: innerManifest, execute: async () => ({ content: "x" }) });
  } catch (error) {
    wrapperNotReplaceable = (error as { code?: string }).code === "TOOL_ALREADY_WRAPPED";
  }

  const sinkRecords: AuditRecord[] = [];
  const audit = new AuditLog({
    sink: { write: (record) => void sinkRecords.push(record) },
    redactor: new Redactor({ secretValues: [SECRET] }),
    now: () => 1_000,
  });
  await audit.record({
    operationId: "op-1",
    actor: "root",
    toolId: "vault_write",
    arguments: { headers: { authorization: `Bearer ${SECRET}` }, env: { API_KEY: "k-123" }, path: "Notes/a.md" },
    targets: ["/vault/Notes/a.md"],
    effects: ["write"],
    decision: "allow",
    status: "executed",
  });
  const serialized = JSON.stringify(sinkRecords[0]);
  const secretRedacted = !serialized.includes(SECRET) && !serialized.includes("Bearer");
  const headerNotPersisted = !serialized.includes("API_KEY") && !serialized.includes("k-123");
  const denialNotSuccess =
    (await errorCode(() =>
      audit.record({
        operationId: "op-2",
        actor: "root",
        toolId: "vault_write",
        arguments: {},
        targets: ["/vault/Notes/a.md"],
        effects: ["write"],
        decision: "deny",
        status: "executed",
      })
    )) === "INVALID_RECORD";
  const safeError = toSafeError("USE_VAULT_TOOL");

  const report: Report = {
    result: "passed",
    policy: { fixtures: fixtures.length, matched, denyBeatsAllow },
    path: {
      vaultEscapeRejected,
      lookalikeRejected,
      symlinkBackRejected,
      windowsAdsRejected,
      linuxCaseSensitive,
    },
    binding: { staleOnArgumentChange, consumedOnce, secondConsumeRejected },
    approval: { noPrompterUnavailable, restartPendingNotAllowed, expiredRejected, rejectNoEffect },
    gateway: { nestedDenied, hiddenDenied, unwrappedDenied, wrapperNotReplaceable },
    audit: {
      secretRedacted,
      headerNotPersisted,
      denialNotSuccess,
      safeErrorCode: safeError.code,
      safeErrorSuggestedTool: safeError.suggestedTool ?? "",
    },
    durationMs: Date.now() - startedAt,
  };
  process.stdout.write(JSON.stringify(report));
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
