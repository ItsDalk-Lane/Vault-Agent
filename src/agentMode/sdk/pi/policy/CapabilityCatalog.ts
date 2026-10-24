import type { VaultAgentMode } from "@/agentMode/session/types";
import type {
  HostToolExecutionGate,
  HostToolExecutionDecision,
} from "@/agentMode/sdk/pi/tools/HostToolDefinition";
import {
  PolicyEngine,
  type PolicyCaller,
  type PolicyScope,
  type PolicyRequest,
} from "./PolicyEngine";

export interface CapabilityContext {
  readonly caller: PolicyCaller;
  readonly mode: VaultAgentMode;
  readonly readOnly?: boolean;
  readonly trustedHost?: boolean;
  readonly scope?: PolicyScope;
  readonly allowedToolNames?: readonly string[];
}

export interface CapabilityAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

type CapabilityMetadata = PolicyRequest["manifest"];

export interface CapabilityDefinition extends CapabilityMetadata {
  readonly checkAvailability?: (context: CapabilityContext) => CapabilityAvailability;
}

export interface CapabilitySnapshot {
  readonly offeredTools: readonly string[];
  readonly unavailableTools: readonly { readonly name: string; readonly reason: string }[];
}

const EMPTY_TOOLS: readonly string[] = Object.freeze([]);
const EMPTY_UNAVAILABLE: CapabilitySnapshot["unavailableTools"] = Object.freeze([]);

export class CapabilityCatalog {
  private readonly definitions = new Map<string, CapabilityDefinition>();
  private readonly policy = new PolicyEngine();
  private executionGate?: HostToolExecutionGate;

  setExecutionGate(gate: HostToolExecutionGate): void {
    this.executionGate = gate;
  }

  async checkExecution(
    ...input: Parameters<HostToolExecutionGate>
  ): Promise<HostToolExecutionDecision> {
    return this.executionGate ? this.executionGate(...input) : {};
  }

  register(definition: CapabilityDefinition): void {
    this.definitions.set(definition.toolId, definition);
  }

  evaluate(name: string, context: CapabilityContext): CapabilityAvailability {
    const definition = this.definitions.get(name);
    if (!definition)
      return { available: false, reason: "The tool has no registered capability definition." };
    if (context.allowedToolNames && !context.allowedToolNames.includes(name))
      return {
        available: false,
        reason: "The tool is outside this task's assigned capability intersection.",
      };
    const availability = definition.checkAvailability?.(context);
    if (availability?.available === false) return availability;
    const decision = this.policy.decide({
      manifest: definition,
      targets: [],
      caller: context.caller,
      mode: context.mode,
      trustedHost: context.trustedHost,
      scope: {
        vaultRoot: context.scope?.vaultRoot ?? "",
        externalRoots: context.scope?.externalRoots ?? EMPTY_TOOLS,
        readOnly:
          context.readOnly === true ||
          context.caller === "fanout" ||
          context.scope?.readOnly === true,
      },
    });
    return decision.decision === "allow"
      ? { available: true }
      : { available: false, reason: decision.message };
  }

  filter(name: string, context: CapabilityContext): boolean {
    return this.evaluate(name, context).available;
  }

  snapshot(names: readonly string[], context: CapabilityContext): CapabilitySnapshot {
    const offered: string[] = [];
    const unavailable: { name: string; reason: string }[] = [];
    for (const name of new Set(names)) {
      const result = this.evaluate(name, context);
      if (result.available) offered.push(name);
      else unavailable.push({ name, reason: result.reason ?? "The capability is unavailable." });
    }
    return {
      offeredTools: offered.length ? Object.freeze(offered) : EMPTY_TOOLS,
      unavailableTools: unavailable.length ? Object.freeze(unavailable) : EMPTY_UNAVAILABLE,
    };
  }
}
