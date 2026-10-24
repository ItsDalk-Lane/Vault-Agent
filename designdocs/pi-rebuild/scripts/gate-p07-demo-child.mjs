import * as path from "node:path";

import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";

import { sha256 } from "@/utils/hash";
import { ExternalScopes } from "@/agentMode/sdk/pi/policy/ExternalScopes";
import { HostExecutionPolicy } from "@/agentMode/sdk/pi/policy/HostExecutionPolicy";
import { GuardedExternalEnv } from "@/agentMode/sdk/pi/tools/GuardedExternalEnv";
import { InterpreterResolver } from "@/agentMode/sdk/pi/tools/InterpreterResolver";
import { NativeTools, type NativeMutationPlan, type NativeMutationReceipt } from "@/agentMode/sdk/pi/tools/NativeTools";
import { NativeCommands } from "@/agentMode/sdk/pi/tools/NativeCommands";
import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import { ProcessSupervisor } from "@/agentMode/sdk/pi/tools/ProcessSupervisor";

// GATE-P07 child: drives the real external-root scope, guarded environment, official Pi read/write/edit
// factories, native command policy and process supervisor to prove native tools run, externalRoot
// authorization works, strict never spawns, and trusted execution exposes timeout/cancel/env cleanup:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const VAULT = "/vault";
const EXTERNAL = "/home/user/docs";
const EXTERNAL_FILE = `${EXTERNAL}/note.md`;
const VAULT_FILE = `${VAULT}/notes/a.md`;

class FakeInspector {
  readonly entries = new Map<string, { kind: "file" | "directory" | "symlink"; nlink?: number; realpath?: string }>();
  async lstat(target: string) {
    const entry = this.entries.get(path.resolve(target));
    return entry === undefined
      ? { kind: "missing" as const }
      : { kind: entry.kind, ...(entry.nlink !== undefined ? { nlink: entry.nlink } : {}) };
  }
  async realpath(target: string) {
    return this.entries.get(path.resolve(target))?.realpath ?? path.resolve(target);
  }
}

class FakeReader {
  readonly bytes: Buffer;
  readonly filePath: string;
  constructor(filePath: string, content: string) {
    this.filePath = filePath;
    this.bytes = Buffer.from(content, "utf8");
  }
  async info() {
    return {
      ok: true as const,
      value: {
        name: path.basename(this.filePath),
        path: this.filePath,
        kind: "file" as const,
        size: this.bytes.length,
        mtimeMs: 1,
      },
    };
  }
  async read(offset: number, length: number) {
    return { ok: true as const, value: this.bytes.subarray(offset, offset + length) };
  }
  async scanLines({ startLine, endLine }: { startLine: number; endLine?: number }) {
    const content = this.bytes.toString("utf8");
    const lines = content.split("\n");
    const starts: number[] = [];
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
      starts.push(offset);
      offset += Buffer.byteLength(lines[index], "utf8") + (index < lines.length - 1 ? 1 : 0);
    }
    const totalLines = lines.length;
    const startIndex = Math.min(startLine, totalLines);
    const endIndex = endLine === undefined ? totalLines : Math.min(endLine, totalLines);
    const start = startIndex >= totalLines ? this.bytes.length : starts[startIndex];
    const end =
      endIndex <= 0 ? start : endIndex >= totalLines ? this.bytes.length : starts[endIndex] - 1;
    const lastLineStart = starts[Math.max(0, Math.min(endIndex - 1, totalLines - 1))];
    const firstLineEnd =
      startIndex < totalLines
        ? starts[startIndex] + Buffer.byteLength(lines[Math.min(startIndex, lines.length - 1)], "utf8")
        : start;
    const selection = this.bytes.subarray(start, Math.max(start, end));
    return {
      ok: true as const,
      value: {
        newlines: lines.length - 1,
        start,
        end,
        firstLineEnd,
        lastLineStart,
        selectedBytes: selection.length,
        firstLineBytes: Buffer.byteLength(lines[Math.min(startIndex, lines.length - 1)] ?? "", "utf8"),
      },
    };
  }
  async close() {
    return undefined;
  }
}

class FakeExecutionEnv {
  readonly id = "fake-external";
  cwd = EXTERNAL;
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  readonly inspector: FakeInspector;
  constructor(inspector: FakeInspector) {
    this.inspector = inspector;
  }
  async absolutePath(target: string) {
    return { ok: true as const, value: path.isAbsolute(target) ? path.resolve(target) : path.resolve(this.cwd, target) };
  }
  async joinPath(parts: string[]) {
    return { ok: true as const, value: path.join(...parts) };
  }
  async canonicalPath(target: string) {
    return { ok: true as const, value: path.resolve(target) };
  }
  async exists(target: string) {
    return { ok: true as const, value: this.files.has(path.resolve(target)) };
  }
  async readTextFile(target: string) {
    const content = this.files.get(path.resolve(target));
    if (content === undefined) return { ok: false as const, error: { code: "not_found", message: "missing" } };
    return { ok: true as const, value: content };
  }
  async writeFile(target: string, content: string | Uint8Array) {
    const resolved = path.resolve(target);
    this.writes.push(resolved);
    this.files.set(resolved, typeof content === "string" ? content : new TextDecoder().decode(content));
    return { ok: true as const, value: undefined };
  }
  async fileInfo(target: string) {
    const resolved = path.resolve(target);
    return {
      ok: true as const,
      value: {
        name: path.basename(resolved),
        path: resolved,
        kind: "file" as const,
        size: (this.files.get(resolved) ?? "").length,
        mtimeMs: 1,
      },
    };
  }
  async createDir() {
    return { ok: true as const, value: undefined };
  }
  async openBinaryReader(target: string) {
    const resolved = path.resolve(target);
    return { ok: true as const, value: new FakeReader(resolved, this.files.get(resolved) ?? "") };
  }
  async cleanup() {
    return undefined;
  }
}

class FakeChild {
  readonly stdout = {
    listeners: [] as Array<(chunk: string) => void>,
    on(_event: "data", listener: (chunk: string) => void) {
      this.listeners.push(listener);
    },
    emit(chunk: string) {
      for (const listener of this.listeners) listener(chunk);
    },
  };
  readonly stderr = { on: () => undefined };
  readonly kills: string[] = [];
  readonly exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
  onExit(listener: (code: number | null, signal: string | null) => void) {
    this.exitListeners.push(listener);
  }
  onError() {
    return undefined;
  }
  kill(signal?: string) {
    this.kills.push(signal ?? "");
    return true;
  }
  emitExit() {
    for (const listener of this.exitListeners) listener(null, "SIGTERM");
  }
}

class FakeSpawner {
  spawned = 0;
  requests: Array<{ env: Readonly<Record<string, string>>; inheritEnv: boolean }> = [];
  readonly children: FakeChild[] = [];
  spawn(request: { env: Readonly<Record<string, string>>; inheritEnv: boolean }) {
    this.spawned += 1;
    this.requests.push(request);
    const child = new FakeChild();
    this.children.push(child);
    return child;
  }
}

class FakeKiller {
  reasons: Array<"timeout" | "cancelled" | "output_limit"> = [];
  outcome: "confirmed" | "incomplete" = "incomplete";
  async terminate(child: FakeChild, reason: "timeout" | "cancelled" | "output_limit") {
    this.reasons.push(reason);
    child.kill("SIGTERM");
    return this.outcome;
  }
}

class FakeTimer {
  nowValue = 0;
  readonly callbacks: Array<() => void> = [];
  now() {
    return this.nowValue;
  }
  setTimeout(callback: () => void) {
    this.callbacks.push(callback);
    return this.callbacks.length;
  }
  clearTimeout() {
    return undefined;
  }
  fireAll() {
    for (const callback of [...this.callbacks]) callback();
  }
}

function outputText(result: { output?: string | readonly { type: string; text?: string }[] }): string {
  if (result.output === undefined) return "";
  if (typeof result.output === "string") return result.output;
  return result.output.map((item) => item.text ?? "").join("");
}

async function main() {
  const startedAt = Date.now();
  const inspector = new FakeInspector();
  inspector.entries.set(EXTERNAL_FILE, { kind: "file", nlink: 1 });
  inspector.entries.set(VAULT_FILE, { kind: "file", nlink: 1, realpath: VAULT_FILE });
  const raw = new FakeExecutionEnv(inspector);
  raw.files.set(EXTERNAL_FILE, "hello old");
  const scopes = new ExternalScopes({
    fileSystem: { realpath: (target) => inspector.realpath(target) },
    path,
    protectedRoots: [VAULT, "/home/user/.config"],
    now: () => 1_000,
  });
  await scopes.createScope({ root: EXTERNAL, permissions: ["read", "write"], createdBy: "user" });
  const guarded = new GuardedExternalEnv({
    raw: raw as unknown as ExecutionEnv,
    scopes,
    inspector,
    path,
    protectedRoots: [VAULT, "/home/user/.config"],
  });

  const plans: NativeMutationPlan[] = [];
  const receipts: NativeMutationReceipt[] = [];
  const nativeTools = new NativeTools({
    registrations: {
      read: createReadTool() as unknown as never,
      write: createWriteTool() as unknown as never,
      edit: createEditTool() as unknown as never,
    },
    env: guarded,
    vaultRoot: VAULT,
    approvals: {
      request: async (plan) => {
        plans.push(plan);
        return { approved: true };
      },
    },
    receipts: {
      record: async (receipt) => {
        receipts.push(receipt);
      },
    },
    path,
    now: () => 2_000,
    operationId: () => `gate-native-${receipts.length + 1}`,
  });

  const read = await nativeTools.execute("read", { path: EXTERNAL_FILE }, {}, {});
  const nativeReadOk = !read.isError && outputText(read).includes("hello old");
  const write = await nativeTools.execute(
    "write",
    { path: EXTERNAL_FILE, content: "hello new" },
    {},
    {}
  );
  const nativeWriteOk =
    !write.isError && raw.files.get(EXTERNAL_FILE) === "hello new" && receipts.length === 1;
  const edit = await nativeTools.execute(
    "edit",
    { path: EXTERNAL_FILE, edits: [{ oldText: "new", newText: "edited" }] },
    {},
    {}
  );
  const nativeEditOk =
    !edit.isError && raw.files.get(EXTERNAL_FILE) === "hello edited" && receipts.length === 2;
  const nativeApprovalPlans = plans.length;
  const vaultRefused = await nativeTools.execute(
    "write",
    { path: VAULT_FILE, content: "should not write" },
    {},
    {}
  );
  const authorizedRead = await guarded.readTextFile(EXTERNAL_FILE, {} as never);
  const unauthorizedRead = await guarded.readTextFile(VAULT_FILE, {} as never);

  const strictPolicy = new HostExecutionPolicy({
    path,
    vaultRoot: VAULT,
    interpreter: { available: true, label: "/bin/bash" },
    defaultCwd: EXTERNAL,
    now: () => 1_000,
  });
  const resolver = new InterpreterResolver({
    platform: "darwin",
    fileSystem: { exists: async (target) => target === "/bin/bash" },
    path,
  });
  let bashCalls = 0;
  const commandRegistrations = {
    bash: {
      name: "bash",
      parameters: {},
      execute: async () => {
        bashCalls += 1;
        return { output: [{ type: "text", text: "bash ran" }] };
      },
    },
    powershell: {
      name: "powershell",
      parameters: {},
      execute: async () => ({ output: [{ type: "text", text: "powershell ran" }] }),
    },
  };
  const strictCommands = new NativeCommands({
    registrations: commandRegistrations,
    policy: strictPolicy,
    interpreter: resolver,
    env: guarded,
    path,
    defaultCwd: EXTERNAL,
    now: () => 1_000,
  });
  const strictResult = await strictCommands.execute("bash", { command: "echo hi" }, {}, {});
  const strictSpawnCalls = bashCalls;

  const trustedPolicy = new HostExecutionPolicy({
    path,
    vaultRoot: VAULT,
    interpreter: { available: true, label: "/bin/bash" },
    defaultCwd: EXTERNAL,
    now: () => 1_000,
  });
  trustedPolicy.confirmTrustedHost({ confirmedBy: "user", riskAcknowledged: true, noticeVersion: 1 });
  const trustedCommands = new NativeCommands({
    registrations: commandRegistrations,
    policy: trustedPolicy,
    interpreter: resolver,
    env: guarded,
    path,
    defaultCwd: EXTERNAL,
    now: () => 1_000,
  });
  const approval = trustedPolicy.approveCommand(
    {
      command: "echo hi",
      cwd: EXTERNAL,
      interpreter: "/bin/bash",
      timeoutMs: 60_000,
      outputLimitBytes: 64 * 1024,
    },
    { approvedByUser: true }
  );
  if (!approval.ok) throw new Error(approval.code);
  const approvedRun = await trustedCommands.execute(
    "bash",
    { command: "echo hi" },
    {},
    { approvalToken: approval.token }
  );
  const replayed = await trustedCommands.execute(
    "bash",
    { command: "echo hi" },
    {},
    { approvalToken: approval.token }
  );
  const trustedVaultCommand = await trustedCommands.execute(
    "bash",
    { command: `cat ${VAULT_FILE}` },
    {},
    {}
  );

  const commandEnv = new CommandEnvironment({
    platform: "darwin",
    parentEnv: { PATH: "/usr/bin", HOME: "/home/user", API_KEY: "sk-gate-secret" },
    knownSecrets: ["sk-gate-secret"],
  });
  const spawner = new FakeSpawner();
  const killer = new FakeKiller();
  const timer = new FakeTimer();
  const supervisor = new ProcessSupervisor({
    spawner,
    environment: commandEnv,
    killer,
    timer,
    spill: { write: async () => "/private/spill/gate" },
    tailBytes: 64,
    spillBytes: 1_024,
  });
  const timeoutRun = supervisor.run({ command: "/bin/sh", args: ["-lc", "sleep 10"], cwd: EXTERNAL, timeoutMs: 5_000 });
  timer.fireAll();
  spawner.children[0].emitExit();
  const timeoutResult = await timeoutRun;
  const timeoutEnv = spawner.requests[0].env;
  const controller = new AbortController();
  const cancelRun = supervisor.run({ command: "/bin/sh", cwd: EXTERNAL }, { signal: controller.signal });
  controller.abort();
  spawner.children[1].emitExit();
  const cancelResult = await cancelRun;

  const report = {
    result: "passed",
    nativeTools: {
      read: nativeReadOk,
      write: nativeWriteOk,
      edit: nativeEditOk,
      approvalPlans: nativeApprovalPlans,
      receipts: receipts.length,
      vaultRefused: vaultRefused.isError === true && outputText(vaultRefused).includes("USE_VAULT_TOOL"),
    },
    externalRoot: {
      authorizedRead: authorizedRead.ok,
      unauthorizedReadDenied: unauthorizedRead.ok === false,
      unauthorizedMessage: unauthorizedRead.ok ? "" : unauthorizedRead.error.message,
    },
    strict: {
      opaque: outputText(strictResult).includes("OPAQUE_EXECUTION_DISABLED"),
      bashCalls: strictSpawnCalls,
    },
    trusted: {
      approvedRun: !approvedRun.isError,
      replayDenied: replayed.isError === true && outputText(replayed).includes("APPROVAL_REQUIRED"),
      vaultCommandDenied:
        trustedVaultCommand.isError === true &&
        outputText(trustedVaultCommand).includes("VAULT_TARGET_IN_COMMAND"),
      timeoutStatus: timeoutResult.status,
      timeoutCleanup: timeoutResult.cleanup,
      cancelStatus: cancelResult.status,
      killerReasons: killer.reasons,
      apiKeyInChildEnv: Object.hasOwn(timeoutEnv, "API_KEY"),
      inheritEnv: spawner.requests[0].inheritEnv,
      secretRedacted: commandEnv.redact("key=sk-gate-secret").includes("[REDACTED]"),
    },
    durationMs: Date.now() - startedAt,
  };
  process.stdout.write(JSON.stringify(report));
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
