import { ToolRegistry, ToolRegistryError } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import type { PolicyCaller } from "@/agentMode/sdk/pi/policy/PolicyEngine";

// beforeTool is only the cheap pre-check: the tool must exist in the host registry and the caller
// must be allowed. A thrown review denies instead of allowing:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ToolHookInput {
  readonly toolId: string;
  readonly caller: PolicyCaller;
}

export type ToolHookDenyCode = "UNKNOWN_TOOL" | "CALLER_NOT_ALLOWED" | "TOOL_REVIEW_FAILED";

export type ToolHookResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: ToolHookDenyCode; readonly message: string };

export class ToolHook {
  private readonly registry: ToolRegistry;

  constructor(options: { readonly registry: ToolRegistry }) {
    this.registry = options.registry;
  }

  async beforeTool(input: ToolHookInput): Promise<ToolHookResult> {
    try {
      const manifest = this.registry.requireManifest(input.toolId);
      if (!manifest.allowedCallers.includes(input.caller)) {
        return {
          allowed: false,
          code: "CALLER_NOT_ALLOWED",
          message: `The caller "${input.caller}" may not use the tool "${input.toolId}".`,
        };
      }
      return { allowed: true };
    } catch (error) {
      if (error instanceof ToolRegistryError && error.code === "UNKNOWN_TOOL") {
        return {
          allowed: false,
          code: "UNKNOWN_TOOL",
          message: `The tool "${input.toolId}" is not registered.`,
        };
      }
      return {
        allowed: false,
        code: "TOOL_REVIEW_FAILED",
        message: "The tool review failed; the call is denied.",
      };
    }
  }
}
