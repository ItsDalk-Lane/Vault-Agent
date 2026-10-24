import { createToolOutcome, type ToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";
import {
  PolicyEngine,
  type PolicyDenyCode,
  type PolicyRule,
  type PolicyScope,
  type PolicyTargetFact,
  type PolicyCaller,
} from "@/agentMode/sdk/pi/policy/PolicyEngine";
import {
  isolateModelArguments,
  ToolManifestError,
  type ToolManifest,
} from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry, ToolRegistryError } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import type { VaultAgentMode } from "@/agentMode/session/types";
import { AuditError, type AuditLog, toSafeError } from "@/agentMode/sdk/pi/policy/AuditLog";

// Every execution path — top-level and nested executeTool — goes through the same gateway. The
// wrapper re-checks cancellation, scope and targets after approval, a review exception denies, a
// hidden tool is not callable, and the raw execute handle is never exposed to callers:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ToolExecutionResult {
  readonly content: string;
  readonly isError?: boolean;
  readonly outcome?: ToolOutcome;
}

export interface GatewayExecuteContext {
  readonly operationId?: string;
  readonly requestId?: string;
  readonly caller: PolicyCaller;
  readonly mode: VaultAgentMode;
  readonly scope: PolicyScope;
  readonly scopeVersion: number;
  readonly policyVersion: number;
  readonly targets: readonly PolicyTargetFact[];
  readonly rules?: readonly PolicyRule[];
  readonly signal?: AbortSignal;
  readonly nested?: boolean;
  /** Model-supplied hints only; never consulted as permission.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  readonly modelTools?: unknown;
}

export interface GatewayToolContext extends GatewayExecuteContext {
  readonly invokeTool: (
    toolId: string,
    args: Record<string, unknown>,
    overrides?: Partial<GatewayExecuteContext>
  ) => Promise<GatewayResult>;
}

export type GatewayDenyCode =
  | PolicyDenyCode
  | "UNKNOWN_TOOL"
  | "TOOL_DISABLED"
  | "TOOL_ALREADY_WRAPPED"
  | "INVALID_MANIFEST"
  | "INVALID_ARGUMENT"
  | "APPROVAL_REJECTED"
  | "APPROVAL_UNAVAILABLE"
  | "CANCELLED"
  | "SCOPE_REVOKED"
  | "TARGET_CHANGED"
  | "TOOL_REVIEW_FAILED"
  | "AUDIT_FAILED"
  | "TOOL_EXECUTION_FAILED"
  | "STALE_BASELINE"
  | "EFFECT_UNKNOWN";

export interface GatewayAllowResult {
  readonly decision: "allow";
  readonly toolId: string;
  readonly content: string;
  readonly isError?: boolean;
  readonly outcome?: ToolOutcome;
}

export interface GatewayDenyResult {
  readonly decision: "deny";
  readonly code: GatewayDenyCode;
  readonly message: string;
  readonly suggestedTool?: string;
  readonly outcome?: ToolOutcome;
}

export type GatewayResult = GatewayAllowResult | GatewayDenyResult;

export type GatewayApprovalOutcome = "approved" | "rejected" | "cancelled" | "unavailable";

export interface GatewayApprovalRequest {
  readonly toolId: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly manifest: ToolManifest;
  readonly targets: readonly PolicyTargetFact[];
  readonly scopeVersion: number;
  readonly policyVersion: number;
}

export interface ToolGatewayOptions {
  readonly audit?: Pick<AuditLog, "record">;
  readonly registry: ToolRegistry;
  readonly policy: PolicyEngine;
  readonly requestApproval?: (request: GatewayApprovalRequest) => Promise<GatewayApprovalOutcome>;
  readonly isScopeActive?: (scopeVersion: number) => boolean;
  readonly revalidateTargets?: (targets: readonly PolicyTargetFact[]) => Promise<boolean>;
}

export interface GatewayToolDefinition {
  readonly toolId: string;
  readonly manifest: ToolManifest;
  readonly execute: (
    args: Record<string, unknown>,
    context: GatewayToolContext
  ) => Promise<ToolExecutionResult>;
}

export class ToolGatewayError extends Error {
  readonly code: GatewayDenyCode;

  constructor(code: GatewayDenyCode, message: string) {
    super(message);
    this.name = "ToolGatewayError";
    this.code = code;
  }
}

interface WrappedTool {
  readonly manifest: ToolManifest;
  readonly execute: GatewayToolDefinition["execute"];
}

export class ToolGateway {
  private readonly audit: ToolGatewayOptions["audit"];
  private readonly registry: ToolRegistry;
  private readonly policy: PolicyEngine;
  private readonly requestApproval: ToolGatewayOptions["requestApproval"];
  private readonly isScopeActive: ToolGatewayOptions["isScopeActive"];
  private readonly revalidateTargets: ToolGatewayOptions["revalidateTargets"];
  private readonly tools = new Map<string, WrappedTool>();
  private readonly disabled = new Set<string>();

  constructor(options: ToolGatewayOptions) {
    this.audit = options.audit;
    this.registry = options.registry;
    this.policy = options.policy;
    this.requestApproval = options.requestApproval;
    this.isScopeActive = options.isScopeActive;
    this.revalidateTargets = options.revalidateTargets;
  }

  registerTool(definition: GatewayToolDefinition): void {
    if (this.tools.has(definition.toolId)) {
      throw new ToolGatewayError(
        "TOOL_ALREADY_WRAPPED",
        `The tool "${definition.toolId}" is already wrapped; the security wrapper cannot be replaced.`
      );
    }
    let registered: ToolManifest;
    try {
      registered = this.registry.requireManifest(definition.toolId);
    } catch {
      throw new ToolGatewayError(
        "UNKNOWN_TOOL",
        `The tool "${definition.toolId}" must be registered before it is wrapped.`
      );
    }
    if (registered.schemaHash !== definition.manifest.schemaHash) {
      throw new ToolGatewayError(
        "INVALID_MANIFEST",
        `The tool "${definition.toolId}" does not match its registered manifest.`
      );
    }
    this.tools.set(
      definition.toolId,
      Object.freeze({ manifest: registered, execute: definition.execute })
    );
  }

  setToolEnabled(toolId: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(toolId);
    else this.disabled.add(toolId);
  }

  async executeTool(
    toolId: string,
    rawArgs: Record<string, unknown>,
    context: GatewayExecuteContext
  ): Promise<GatewayResult> {
    const manifest = this.tools.get(toolId)?.manifest;
    let started = false;
    const record = async (
      decision: "allow" | "deny" | "cancelled",
      status: "approved" | "executed" | "rejected" | "failed" | "cancelled"
    ) => {
      await this.audit?.record({
        operationId: context.operationId ?? toolId,
        requestId: context.requestId,
        actor: context.caller === "root" ? "root" : "child",
        toolId,
        arguments: rawArgs,
        targets: context.targets.map((target) => target.value),
        effects: manifest?.effects ?? [],
        decision,
        status,
      });
    };
    try {
      let result: GatewayResult;
      try {
        result = await this.executeReviewed(
          toolId,
          rawArgs,
          context,
          () => record("allow", "approved"),
          () => {
            started = true;
          }
        );
      } catch (error) {
        if (error instanceof AuditError) throw error;
        result = deny("TOOL_REVIEW_FAILED", "The tool review did not complete.");
      }
      await record(
        result.decision === "allow" ? "allow" : result.code === "CANCELLED" ? "cancelled" : "deny",
        result.decision === "allow"
          ? result.isError
            ? "failed"
            : "executed"
          : result.code === "CANCELLED"
            ? "cancelled"
            : started
              ? "failed"
              : "rejected"
      );
      return {
        ...result,
        outcome:
          result.outcome ??
          createToolOutcome({
            operationId: context.operationId ?? toolId,
            toolId,
            caller: context.caller,
            success: result.decision === "allow" && !result.isError,
            effect:
              result.decision === "allow"
                ? result.isError
                  ? "unknown"
                  : "applied"
                : started && result.code !== "STALE_BASELINE"
                  ? "unknown"
                  : "not_applied",
            ...(result.decision === "allow"
              ? { data: { text: result.content } }
              : {
                  error: {
                    code: result.code,
                    phase: started ? ("execution" as const) : ("review" as const),
                    message: result.message,
                  },
                }),
          }),
      };
    } catch {
      const message = started
        ? "审计记录保存失败。操作可能已经发生，请核对原记录，勿重复执行。"
        : toSafeError("AUDIT_FAILED").message;
      return {
        decision: "deny",
        code: "AUDIT_FAILED",
        message,
        outcome: createToolOutcome({
          operationId: context.operationId ?? toolId,
          toolId,
          caller: context.caller,
          success: false,
          effect: started ? "unknown" : "not_applied",
          error: { code: "AUDIT_FAILED", phase: "persistence", message },
        }),
      };
    }
  }

  private async executeReviewed(
    toolId: string,
    rawArgs: Record<string, unknown>,
    context: GatewayExecuteContext,
    beforeExecute: () => Promise<void>,
    markStarted: () => void
  ): Promise<GatewayResult> {
    if (this.disabled.has(toolId)) {
      return deny("TOOL_DISABLED", `The tool "${toolId}" is not enabled.`);
    }
    const tool = this.tools.get(toolId);
    if (tool === undefined) {
      return deny("UNKNOWN_TOOL", `The tool "${toolId}" is not wrapped by the gateway.`);
    }
    if (isAborted(context)) {
      return deny("CANCELLED", "The call was cancelled before review.");
    }

    let args: Record<string, unknown>;
    try {
      args = isolateModelArguments(tool.manifest, rawArgs);
    } catch (error) {
      return deny(
        "INVALID_ARGUMENT",
        error instanceof ToolManifestError ? error.message : "The tool arguments are invalid."
      );
    }

    let requiresApproval: boolean;
    try {
      const decision = this.policy.decide({
        manifest: tool.manifest,
        targets: context.targets,
        mode: context.mode,
        caller: context.caller,
        scope: context.scope,
        rules: context.rules,
      });
      if (decision.decision === "deny") {
        return deny(decision.code, decision.message);
      }
      requiresApproval = decision.requiresApproval;
    } catch {
      return deny("TOOL_REVIEW_FAILED", "The tool review failed; the call is denied.");
    }

    if (requiresApproval) {
      if (this.requestApproval === undefined) {
        return deny("APPROVAL_UNAVAILABLE", "No approval prompt is available; the call is denied.");
      }
      const outcome = await this.requestApproval({
        toolId,
        arguments: args,
        manifest: tool.manifest,
        targets: context.targets,
        scopeVersion: context.scopeVersion,
        policyVersion: context.policyVersion,
      });
      if (isAborted(context)) {
        return deny("CANCELLED", "The call was cancelled while waiting for approval.");
      }
      if (outcome === "cancelled") {
        return deny("CANCELLED", "The approval was cancelled.");
      }
      if (outcome === "unavailable") {
        return deny("APPROVAL_UNAVAILABLE", "The approval prompt is unavailable.");
      }
      if (outcome !== "approved") {
        return deny("APPROVAL_REJECTED", "The call was rejected.");
      }
      if (this.isScopeActive !== undefined && !this.isScopeActive(context.scopeVersion)) {
        return deny("SCOPE_REVOKED", "The scope was revoked while the approval was pending.");
      }
      if (
        this.revalidateTargets !== undefined &&
        !(await this.revalidateTargets(context.targets))
      ) {
        return deny("TARGET_CHANGED", "The target changed while the approval was pending.");
      }
    }

    if (isAborted(context)) {
      return deny("CANCELLED", "The call was cancelled before execution.");
    }

    await beforeExecute();
    // 保存批准本身会让出执行权；撤权、取消或目标变化必须在真正调用宿主前再次拦截。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (this.disabled.has(toolId))
      return deny("TOOL_DISABLED", `The tool "${toolId}" is not enabled.`);
    if (requiresApproval) {
      if (this.isScopeActive && !this.isScopeActive(context.scopeVersion))
        return deny("SCOPE_REVOKED", "The scope was revoked before execution.");
      if (this.revalidateTargets && !(await this.revalidateTargets(context.targets)))
        return deny("TARGET_CHANGED", "The target changed before execution.");
      if (this.isScopeActive && !this.isScopeActive(context.scopeVersion))
        return deny("SCOPE_REVOKED", "The scope was revoked before execution.");
    }
    if (isAborted(context)) return deny("CANCELLED", "The call was cancelled before execution.");
    if (this.disabled.has(toolId))
      return deny("TOOL_DISABLED", `The tool "${toolId}" is not enabled.`);
    markStarted();
    try {
      const result = await tool.execute(args, {
        ...context,
        invokeTool: (nestedToolId, nestedArgs, overrides) =>
          this.executeTool(nestedToolId, nestedArgs, {
            ...context,
            ...overrides,
            nested: true,
          }),
      });
      return {
        decision: "allow",
        toolId,
        content: result.content,
        ...(result.outcome ? { outcome: result.outcome } : {}),
        ...(result.isError === true ? { isError: true } : {}),
      };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "STALE_BASELINE" || code === "EFFECT_UNKNOWN" || code === "CANCELLED")
        return deny(code, "The operation needs review before continuing.");
      return deny("TOOL_EXECUTION_FAILED", `The tool "${toolId}" failed while executing.`);
    }
  }
}

function isAborted(context: GatewayExecuteContext): boolean {
  return context.signal?.aborted === true;
}

function deny(code: GatewayDenyCode, message: string): GatewayDenyResult {
  const safe = toSafeError(code);
  return {
    decision: "deny",
    code,
    message: safe.code === "INTERNAL_ERROR" ? message : safe.message,
    ...(safe.suggestedTool ? { suggestedTool: safe.suggestedTool } : {}),
  };
}

export { ToolRegistry, ToolRegistryError };
