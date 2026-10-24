import * as nodePath from "node:path";

import * as fs from "node:fs";
import * as path from "node:path";

import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import { ApprovalStore } from "@/agentMode/sdk/pi/policy/ApprovalStore";
import type { ApprovalOption } from "@/agentMode/sdk/pi/policy/ApprovalStore";
import { McpToolNameRegistry } from "@/agentMode/sdk/pi/mcp/McpToolNames";
import {
  McpSecretRefs,
  assertMcpSecretRef,
  isMcpSecretRef,
} from "@/agentMode/sdk/pi/mcp/McpSecretRefs";
import { KeychainCredentialStore } from "@/agentMode/sdk/pi/models/KeychainCredentialStore";
import { PathResolver, PathResolverError } from "@/agentMode/sdk/pi/policy/PathResolver";
import {
  PlatformPathPolicy,
  PlatformPathError,
} from "@/agentMode/sdk/pi/policy/PlatformPathPolicy";
import { PolicyEngine } from "@/agentMode/sdk/pi/policy/PolicyEngine";
import type { PolicyRequest, PolicyRule } from "@/agentMode/sdk/pi/policy/PolicyEngine";
import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";
import { computeSubagentScope } from "@/agentMode/sdk/pi/features/subagents/SubagentScope";
import type { ToolManifest, ToolFamily, ToolEffect } from "@/agentMode/sdk/pi/policy/ToolManifest";
import { sha256 } from "@/utils/hash";

// Security regression: unknown paths are denied before approval, plan mode cannot write, a subagent
// cannot gain rights its parent lacks, and secrets never reach data.json, logs, exports or child env.
// Every case drives the real policy/path/approval/credential modules over injected ports:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const packRoot = path.resolve(__dirname, "../../../../..", "designdocs/pi-rebuild");
const policyCases = (
  JSON.parse(fs.readFileSync(path.join(packRoot, "fixtures/policy-cases.json"), "utf8")) as {
    cases: PolicyCase[];
  }
).cases;

interface PolicyCase {
  id: string;
  toolFamily: ToolFamily;
  resolvedZone?: string;
  mode: "default" | "plan" | "auto";
  effect: ToolEffect;
  code?: string;
  expected: "allow" | "ask" | "deny";
  caller?: string;
  actor?: string;
  inScope?: boolean;
  scopeGranted?: boolean;
  childReadOnly?: boolean;
  allowRule?: boolean;
  denyRule?: boolean;
  priorApproval?: boolean;
  argumentsChanged?: boolean;
  expired?: boolean;
  cancelled?: boolean;
  approved?: boolean;
  nlink?: number;
  callable?: boolean;
  toolId?: string;
  trustedHost?: boolean;
  realTargetZone?: string;
}

const engine = new PolicyEngine();

function manifestFor(
  family: ToolFamily,
  effect: ToolEffect,
  overrides: Partial<ToolManifest> = {}
): ToolManifest {
  const allowedCallers: ToolManifest["allowedCallers"] = overrides.allowedCallers ?? [
    "root",
    "subagent",
  ];
  return {
    toolId: `${family}_${effect}_tool`,
    description: "Scoped test tool.",
    family,
    effects: [effect],
    parameters: {},
    extractTargets: () => [],
    implementationVersion: 1,
    schemaVersion: 1,
    replayPolicy: "idempotent",
    allowedCallers,
    maxOutputBytes: 1024,
    schemaHash: sha256(`${family}:${effect}`),
    ...overrides,
  };
}

function userApprovalOptions(): readonly ApprovalOption[] {
  return [{ optionId: "allow-once", kind: "allow_once" }];
}

const HOST_STRICT = { trustedHost: false } as const;

function requestFor(testCase: PolicyCase): PolicyRequest {
  const target = (() => {
    switch (testCase.resolvedZone) {
      case "vault":
        return {
          kind: "vault_path" as const,
          value: "Notes/Agent.md",
          insideScope: testCase.inScope !== false,
        };
      case "external":
        return testCase.realTargetZone === "vault"
          ? { kind: "vault_path" as const, value: "Notes/Agent.md", insideScope: true }
          : {
              kind: "external_path" as const,
              value: "/tmp/agent/out.txt",
              insideScope: testCase.inScope !== false,
            };
      case "protected":
        return { kind: "vault_path" as const, value: "config/app.json", protected: true };
      case "remote":
        return { kind: "operation" as const, value: "mcp:remote:tool" };
      default:
        return { kind: "operation" as const, value: "state" };
    }
  })();
  const rules: PolicyRule[] = [];
  if (testCase.allowRule === true) {
    rules.push({ id: "allow-rule", decision: "allow", effect: testCase.effect });
  }
  if (testCase.denyRule === true) {
    rules.push({ id: "deny-rule", decision: "deny", effect: testCase.effect });
  }
  const trustedHost =
    testCase.trustedHost ?? (testCase.toolFamily === "host_process" && testCase.id === "POL-13");
  return {
    manifest: manifestFor(testCase.toolFamily, testCase.effect, {
      ...(testCase.id === "POL-27"
        ? {
            toolId: testCase.toolId ?? "delegate_task",
            allowedCallers: ["root"],
            replayPolicy: "read_only" as const,
          }
        : {}),
    }),
    targets: [target],
    mode: testCase.mode,
    caller: testCase.actor === "subagent" || testCase.caller === "tools" ? "subagent" : "root",
    scope: {
      vaultRoot: "/vault",
      externalRoots:
        testCase.toolFamily === "native_file" || testCase.toolFamily === "host_process"
          ? ["/tmp"]
          : [],
      readOnly: testCase.childReadOnly === true,
    },
    rules,
    ...(testCase.callable === false ? { toolEnabled: false } : {}),
    ...(trustedHost ? { trustedHost: true } : HOST_STRICT),
  };
}

function decisionShape(decision: ReturnType<PolicyEngine["decide"]>) {
  if (decision.decision === "deny") return "deny";
  return decision.requiresApproval ? "ask" : "allow";
}

describe("securityBoundary", () => {
  describe("securityBoundary", () => {
    describe("PolicyEngine", () => {
      const engineCodes: Readonly<Record<string, string>> = {
        "POL-03": "READ_ONLY_MODE",
        "POL-07": "USE_VAULT_TOOL",
        "POL-08": "PROTECTED_PATH",
        "POL-09": "PATH_OUT_OF_SCOPE",
        "POL-12": "OPAQUE_EXECUTION_DISABLED",
        "POL-14": "READ_ONLY_MODE",
        "POL-16": "READ_ONLY_MODE",
        "POL-19": "PERMISSION_DENIED",
        "POL-24": "PROTECTED_PATH",
        "POL-25": "READ_ONLY_MODE",
        "POL-26": "TOOL_DISABLED",
        "POL-27": "CALLER_NOT_ALLOWED",
        "POL-28": "USE_VAULT_TOOL",
      };

      // 停止由实际 Runtime/ToolGateway 的取消回归验证，纯策略夹具不能冒充执行入口。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      it.each(
        policyCases
          .filter((testCase) => !testCase.cancelled)
          .map((testCase) => [testCase.id, testCase] as const)
      )("judges policy fixture %s with the pack's expected outcome", async (_id, testCase) => {
        if (testCase.id === "POL-23") {
          const policy = new PlatformPathPolicy({ platform: "posix" });
          expect(() => policy.assertWritableTarget({ nlink: testCase.nlink ?? 1 })).toThrow(
            PlatformPathError
          );
          return;
        }
        const decision = engine.decide(requestFor(testCase));

        expect(decisionShape(decision)).toBe(testCase.expected);
        const expectedCode = engineCodes[testCase.id];
        if (expectedCode !== undefined && decision.decision === "deny") {
          expect(decision.code).toBe(expectedCode);
        }
      });

      it("denies unknown vault paths before approval", () => {
        const decision = engine.decide(
          requestFor({ ...policyCases[0], resolvedZone: "vault", inScope: false })
        );

        expect(decision).toMatchObject({ decision: "deny", code: "PATH_OUT_OF_SCOPE" });
      });

      it("denies external paths without an authorized root", () => {
        const decision = engine.decide({
          ...requestFor({
            id: "external-no-root",
            toolFamily: "native_file",
            resolvedZone: "external",
            mode: "default",
            effect: "read",
            expected: "allow",
          }),
          scope: { vaultRoot: "/vault", externalRoots: [], readOnly: false },
        });

        expect(decision).toMatchObject({ decision: "deny", code: "EXTERNAL_SCOPE_REQUIRED" });
      });

      it("denies host processes in strict mode even when the family is allowed", () => {
        const decision = engine.decide({
          ...requestFor({
            id: "host-strict",
            toolFamily: "host_process",
            resolvedZone: "external",
            mode: "default",
            effect: "execute",
            expected: "ask",
          }),
          trustedHost: false,
        });

        expect(decision).toMatchObject({
          decision: "deny",
          code: "OPAQUE_EXECUTION_DISABLED",
        });
      });

      it("never lets plan mode write, delete, rename or execute", () => {
        for (const effect of ["write", "create", "delete", "rename", "execute"] as const) {
          const decision = engine.decide(
            requestFor({
              id: `plan-${effect}`,
              toolFamily: "vault",
              resolvedZone: "vault",
              mode: "plan",
              effect,
              expected: "deny",
            })
          );

          expect(decision).toMatchObject({ decision: "deny", code: "READ_ONLY_MODE" });
        }
      });

      it("allows plan mode to read and report state", () => {
        for (const effect of ["read", "state"] as const) {
          const decision = engine.decide(
            requestFor({
              id: `plan-${effect}`,
              toolFamily: "control",
              resolvedZone: "vault",
              mode: "plan",
              effect,
              expected: "allow",
            })
          );

          expect(decision).toMatchObject({ decision: "allow", requiresApproval: false });
        }
      });
    });

    describe("ApprovalStore", () => {
      function approvalInput(argumentsValue: string) {
        return {
          approvalId: "approval-1",
          toolId: "vault_write",
          schemaHash: "schema-1",
          arguments: { path: "Notes/Agent.md", content: argumentsValue },
          targets: ["Notes/Agent.md"],
          beforeHash: "before-1",
          scopeVersion: 1,
          policyVersion: 1,
        };
      }

      it("requires a new approval when the arguments changed", async () => {
        const store = new ApprovalStore({ now: () => 1_000, ttlMs: 60_000 });
        const request = await store.createRequest(approvalInput("v1"), userApprovalOptions());
        await store.decide(request, "allow-once");

        const status = store.status("approval-1", {
          schemaHash: "schema-1",
          arguments: { path: "Notes/Agent.md", content: "v2" },
          targets: ["Notes/Agent.md"],
          beforeHash: "before-1",
          scopeVersion: 1,
          policyVersion: 1,
        });

        expect(status).toBe("stale");
        await expect(
          store.consumeOnce(
            "approval-1",
            {
              schemaHash: "schema-1",
              arguments: { path: "Notes/Agent.md", content: "v2" },
              targets: ["Notes/Agent.md"],
              beforeHash: "before-1",
              scopeVersion: 1,
              policyVersion: 1,
            },
            "intent-1"
          )
        ).rejects.toMatchObject({ code: "APPROVAL_STALE" });
      });

      it("refuses an expired approval", async () => {
        const store = new ApprovalStore({ now: () => 1_000, ttlMs: 10 });
        const request = await store.createRequest(approvalInput("v1"), userApprovalOptions());
        await store.decide(request, "allow-once");

        expect(store.status("approval-1", approvalInput("v1"), 2_000)).toBe("expired");
        await expect(
          store.consumeOnce("approval-1", approvalInput("v1"), "intent-2", 2_000)
        ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
      });

      it("consumes an allow-once approval only once", async () => {
        const store = new ApprovalStore({ now: () => 1_000 });
        const request = await store.createRequest(approvalInput("v1"), userApprovalOptions());
        await store.decide(request, "allow-once");

        await store.consumeOnce("approval-1", approvalInput("v1"), "intent-1");
        await expect(
          store.consumeOnce("approval-1", approvalInput("v1"), "intent-2")
        ).rejects.toMatchObject({ code: "APPROVAL_CONSUMED" });
      });
    });

    describe("PlatformPathPolicy", () => {
      it("refuses a hard-link write target", () => {
        const policy = new PlatformPathPolicy({ platform: "posix" });

        expect(() => policy.assertWritableTarget({ nlink: 2 })).toThrow(PlatformPathError);
        expect(() => policy.assertWritableTarget({ nlink: 1 })).not.toThrow();
      });
    });

    describe("PathResolver", () => {
      const vaultRoot = "/vault";
      const symlinks = new Map<string, string>([
        ["/vault/Notes/link.md", "/etc/passwd"],
        ["/vault/Notes/link-to-outside", "/tmp/agent/out.txt"],
      ]);
      function fakeResolver(protectedRoots: readonly string[] = []) {
        return new PathResolver({
          vaultRoot,
          protectedRoots,
          fileSystem: {
            realpath: async (target: string) => symlinks.get(target) ?? target,
            lstat: async (target: string) => ({ nlink: target.includes("hardlink") ? 2 : 1 }),
          },
          path: {
            isAbsolute: (target) => nodePath.posix.isAbsolute(target),
            normalize: (target) => nodePath.posix.normalize(target),
            resolve: (...parts) => nodePath.posix.resolve(...parts),
            relative: (from, to) => nodePath.posix.relative(from, to),
            dirname: (target) => nodePath.posix.dirname(target),
            basename: (target) => nodePath.posix.basename(target),
            join: (...parts) => nodePath.posix.join(...parts),
            sep: "/",
          },
          platformPolicy: new PlatformPathPolicy({ platform: "posix" }),
        });
      }

      it("rejects an absolute or parent-escaped vault path", async () => {
        const resolver = fakeResolver();

        await expect(resolver.resolveVaultPath("/etc/passwd")).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
        });
        await expect(resolver.resolveVaultPath("../outside.md")).rejects.toMatchObject({
          code: "PATH_OUT_OF_SCOPE",
        });
      });

      it("judges a symlink by its real target and rejects the escape", async () => {
        const resolver = fakeResolver();

        await expect(resolver.resolveVaultPath("Notes/link.md")).rejects.toMatchObject({
          code: "PATH_OUT_OF_SCOPE",
        });
        await expect(resolver.resolveVaultPath("Notes/regular.md")).resolves.toMatchObject({
          kind: "vault",
          relative: "Notes/regular.md",
        });
      });

      it("rejects every protected host root", async () => {
        const resolver = fakeResolver(["/vault/config"]);

        await expect(resolver.resolveVaultPath("config/app.json")).rejects.toMatchObject({
          code: "PROTECTED_PATH",
        });
      });

      it("rejects an external path that resolves back into the vault", async () => {
        const resolver = fakeResolver();

        await expect(
          resolver.resolveExternalPath("/vault/Notes/Agent.md", "/tmp/agent")
        ).rejects.toMatchObject({ code: "PATH_OUT_OF_SCOPE" });
      });

      it("defaults unknown or malformed paths to rejection", async () => {
        const resolver = fakeResolver();

        for (const raw of ["", "Notes/\0.md", "../escape.md", "Notes/../../outside.md"]) {
          await expect(resolver.resolveVaultPath(raw)).rejects.toBeInstanceOf(PathResolverError);
        }
      });
    });

    describe("subagent scope", () => {
      it("cannot gain a write effect the parent lacks", () => {
        const scope = computeSubagentScope({
          parent: {
            callableTools: ["vault_read", "vault_write"],
            effects: ["read"],
            modelKey: "m1",
            depth: 0,
            maxDepth: 2,
          },
          profile: { profileId: "coder", effects: ["read", "write"], maxDepth: 2 } as never,
          toolAllowlist: ["vault_read", "vault_write"],
        });

        expect(scope.effects).not.toContain("write");
        expect(scope.effects).toEqual(["read"]);
      });

      it("drops hidden parent tools and delegation at the depth limit", () => {
        const scope = computeSubagentScope({
          parent: {
            callableTools: ["vault_read", "delegate_task"],
            effects: ["read"],
            modelKey: "m1",
            depth: 1,
            maxDepth: 2,
          },
          profile: { profileId: "researcher", effects: ["read"], maxDepth: 2 } as never,
          toolAllowlist: ["vault_read", "delegate_task"],
        });

        expect(scope.tools).toEqual(["vault_read"]);
        expect(scope.delegationAllowed).toBe(false);
      });

      it("denies a caller the manifest does not list", () => {
        const decision = engine.decide({
          ...requestFor({
            id: "subagent-denied",
            toolFamily: "vault",
            resolvedZone: "vault",
            mode: "default",
            effect: "write",
            expected: "allow",
          }),
          manifest: manifestFor("vault", "write", { allowedCallers: ["root"] }),
          caller: "subagent",
        });

        expect(decision).toMatchObject({ decision: "deny", code: "CALLER_NOT_ALLOWED" });
      });
    });

    describe("secrets", () => {
      it("stores MCP credentials as keychain refs and rejects plaintext", async () => {
        const store = new Map<string, string>();
        const secrets = new McpSecretRefs({
          store: {
            read: async (ref) => store.get(ref),
            write: async (ref, value) => {
              store.set(ref, value);
            },
            delete: async (ref) => {
              store.delete(ref);
            },
          },
        });

        const stored = await secrets.store("remote-docs", "token", "sk-mcp-live-token");

        expect(isMcpSecretRef(stored.ref)).toBe(true);
        expect(stored.source).toBe("keychain");
        expect(store.get(stored.ref)).toBe("sk-mcp-live-token");
        expect(await secrets.resolve(stored.ref)).toBe("sk-mcp-live-token");
        expect(() => assertMcpSecretRef("sk-mcp-live-token", "token")).toThrow(
          /secretRef, not a plaintext value/
        );
        expect(() => assertMcpSecretRef("plaintext", "token")).toThrow(/secretRef/);
      });

      it("keeps provider credentials out of the vault settings payload", async () => {
        const keychain = new Map<string, string>();
        const credentialStore = new KeychainCredentialStore({
          keychain: {
            getVaultId: () => "vault-1",
            isAvailable: () => true,
            getSecretById: (id) => keychain.get(id) ?? null,
            setSecretById: (id, value) => {
              keychain.set(id, value);
            },
            deleteSecretById: (id) => {
              keychain.delete(id);
            },
          },
        });
        const dataJson: Record<string, unknown> = {};

        await credentialStore.modify("byok-openai", async () => ({
          type: "api_key",
          key: "sk-live-provider",
        }));

        expect(JSON.stringify(dataJson)).not.toContain("sk-live-provider");
        expect([...keychain.values()].join("\n")).toContain("sk-live-provider");
      });

      it("redacts secret values and secret-named fields before logging", () => {
        const redactor = new Redactor({ secretValues: ["sk-live-provider"] });
        const payload = {
          authorization: "Bearer sk-live-provider",
          headers: { "x-test": "1" },
          nested: { apiKey: "sk-live-provider", note: "token sk-live-provider ends" },
        };

        const redacted = JSON.stringify(redactor.redactValue(payload));

        expect(redacted).not.toContain("sk-live-provider");
        expect(redacted).not.toContain("Bearer");
        expect(redactor.redactAndTruncate("sk-live-provider", 20)).toBe("[REDACTED]");
        expect(redactor.summarize(payload)).not.toContain("sk-live-provider");
      });

      it("removes secrets from child command environments and output", () => {
        const environment = new CommandEnvironment({
          platform: "linux",
          parentEnv: {
            PATH: "/usr/bin",
            HOME: "/home/user",
            OPENAI_API_KEY: "sk-live-provider",
            GITHUB_TOKEN: "gh-token-value",
            SAFE_VALUE: "visible",
          },
          knownSecrets: ["sk-live-provider"],
        });

        const built = environment.build({ userEnv: { EXTRA_KEY: "x", API_KEY: "y" } });

        expect(built.inheritEnv).toBe(false);
        expect(built.env.PATH).toBe("/usr/bin");
        expect(built.env.SAFE_VALUE).toBeUndefined();
        expect(built.env.EXTRA_KEY).toBe("x");
        expect(built.env.OPENAI_API_KEY).toBeUndefined();
        expect(built.env.GITHUB_TOKEN).toBeUndefined();
        expect(built.env.API_KEY).toBeUndefined();
        expect(built.filteredUserKeys).toEqual(["API_KEY"]);
        expect(environment.redact("key sk-live-provider and gh-token-value")).toBe(
          "key [REDACTED] and [REDACTED]"
        );
      });

      it("does not mistake an MCP tool name for a subagent or host tool", () => {
        const registry = new McpToolNameRegistry();

        const internal = registry.register("delegate_task", "spawn");

        expect(registry.resolve(internal)).toEqual({
          serverId: "delegate_task",
          toolName: "spawn",
        });
        expect(internal.startsWith("mcp_")).toBe(true);
        expect(internal).not.toBe("delegate_task");
      });
    });
  });
});
