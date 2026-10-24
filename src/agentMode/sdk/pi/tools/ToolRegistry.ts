import {
  describeToolManifest,
  isReservedToolName,
  type ToolManifest,
  type ToolManifestDescription,
} from "@/agentMode/sdk/pi/policy/ToolManifest";

// The registry is the only gate between a host-written manifest and the tool gateway. It keeps
// plain manifests, never the raw Pi registry, so UI/skills/MCP receive descriptions and cannot
// call or replace host tools by registering the same name:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type ToolRegistrationSource = "host" | "extension" | "mcp";

export type ToolRegistryErrorCode =
  | "UNKNOWN_TOOL"
  | "DUPLICATE_TOOL"
  | "RESERVED_TOOL_NAME"
  | "SCHEMA_VERSION_CONFLICT"
  | "INVALID_MANIFEST";

export class ToolRegistryError extends Error {
  readonly code: ToolRegistryErrorCode;

  constructor(code: ToolRegistryErrorCode, message: string) {
    super(message);
    this.name = "ToolRegistryError";
    this.code = code;
  }
}

interface RegisteredTool {
  readonly manifest: ToolManifest;
  readonly source: ToolRegistrationSource;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(manifest: ToolManifest, source: ToolRegistrationSource): void {
    if (!isManifestLike(manifest)) {
      throw new ToolRegistryError("INVALID_MANIFEST", "A tool manifest must be defined first.");
    }
    const toolId = manifest.toolId;
    const existing = this.tools.get(toolId);
    if (source !== "host" && isReservedToolName(toolId)) {
      throw new ToolRegistryError(
        "RESERVED_TOOL_NAME",
        `The tool name "${toolId}" is reserved for host tools.`
      );
    }
    if (existing === undefined) {
      this.tools.set(toolId, { manifest, source });
      return;
    }
    if (existing.source === "host" && source !== "host") {
      throw new ToolRegistryError(
        "RESERVED_TOOL_NAME",
        `The host tool "${toolId}" cannot be replaced by a ${source} registration.`
      );
    }
    if (existing.manifest.schemaVersion === manifest.schemaVersion) {
      if (existing.manifest.schemaHash !== manifest.schemaHash) {
        throw new ToolRegistryError(
          "SCHEMA_VERSION_CONFLICT",
          `The tool "${toolId}" reuses schemaVersion ${manifest.schemaVersion} with a different schema.`
        );
      }
      throw new ToolRegistryError(
        "DUPLICATE_TOOL",
        `The tool "${toolId}" is already registered at schemaVersion ${manifest.schemaVersion}.`
      );
    }
    if (source !== "host") {
      throw new ToolRegistryError(
        "DUPLICATE_TOOL",
        `The tool "${toolId}" is already registered and only the host may upgrade its schema.`
      );
    }
    if (manifest.implementationVersion <= existing.manifest.implementationVersion) {
      throw new ToolRegistryError(
        "SCHEMA_VERSION_CONFLICT",
        `The tool "${toolId}" needs a higher implementationVersion to upgrade its schema.`
      );
    }
    this.tools.set(toolId, { manifest, source });
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  requireManifest(toolId: string): ToolManifest {
    const registered = this.tools.get(toolId);
    if (registered === undefined) {
      throw new ToolRegistryError("UNKNOWN_TOOL", `The tool "${toolId}" is not registered.`);
    }
    return registered.manifest;
  }

  describe(toolId: string): ToolManifestDescription | null {
    const registered = this.tools.get(toolId);
    return registered === undefined ? null : describeToolManifest(registered.manifest);
  }

  listDescriptions(): readonly ToolManifestDescription[] {
    return Object.freeze(
      [...this.tools.values()].map((registered) => describeToolManifest(registered.manifest))
    );
  }
}

function isManifestLike(value: unknown): value is ToolManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ToolManifest>;
  return (
    typeof candidate.toolId === "string" &&
    typeof candidate.schemaHash === "string" &&
    typeof candidate.family === "string" &&
    Array.isArray(candidate.effects) &&
    typeof candidate.extractTargets === "function"
  );
}
