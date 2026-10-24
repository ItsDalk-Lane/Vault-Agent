import {
  defineToolManifest,
  describeToolManifest,
  type ToolManifestDescription,
} from "@/agentMode/sdk/pi/policy/ToolManifest";
import type { SkillIndexEntry, SkillTrust } from "@/agentMode/sdk/pi/features/SkillsCatalog";
import { sha256 } from "@/utils/hash";

// 技能正文仅作为说明读取；代码示例不能被当作执行，实际程序仍需独立走宿主批准。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const SKILL_LOAD_TOOL_ID = "load_skill";

export interface SkillToolCatalogPort {
  entry(skillId: string): SkillIndexEntry | undefined;
  loadInstructions(skillId: string): Promise<{
    readonly skillId: string;
    readonly contentHash: string;
    readonly text: string;
  }>;
}

export interface SkillHostProcessPort {
  requestApproval(input: { readonly skillId: string; readonly command: string }): Promise<{
    readonly approved: boolean;
    readonly requestId?: string;
    readonly reason?: string;
    readonly result?: SkillToolResult;
  }>;
}

export type SkillToolErrorCode =
  | "SKILL_UNKNOWN"
  | "SKILL_DISABLED"
  | "SKILL_TRUST_REQUIRED"
  | "SKILL_RESOURCE_ESCAPE"
  | "SKILL_SCRIPT_NOT_APPROVED"
  | "SKILL_INVALID";

export interface SkillToolResult {
  readonly isError: boolean;
  readonly output: readonly { readonly type: "text"; readonly text: string }[];
  readonly details: Readonly<Record<string, unknown>>;
}

export interface SkillToolsOptions {
  readonly catalog: SkillToolCatalogPort;
  readonly hostProcess?: SkillHostProcessPort;
  readonly readResource?: (input: {
    readonly skillId: string;
    readonly relativePath: string;
  }) => Promise<string>;
  readonly allowedTrusts?: readonly SkillTrust[];
  readonly maxInstructionsBytes?: number;
}

const DEFAULT_ALLOWED_TRUSTS: readonly SkillTrust[] = Object.freeze(["builtin", "user", "project"]);

export class SkillTools {
  readonly #options: SkillToolsOptions;
  readonly #manifest: ToolManifestDescription;

  constructor(options: SkillToolsOptions) {
    this.#options = options;
    this.#manifest = describeToolManifest(
      defineToolManifest({
        toolId: SKILL_LOAD_TOOL_ID,
        family: "control",
        effects: ["read", "state"],
        parameters: {
          type: "object",
          properties: {
            skillId: { type: "string" },
            resources: { type: "array", items: { type: "string" } },
          },
          required: ["skillId"],
        },
        extractTargets: () => [{ kind: "operation", value: SKILL_LOAD_TOOL_ID }],
        implementationVersion: 1,
        schemaVersion: 1,
        replayPolicy: "read_only",
        allowedCallers: ["root", "subagent"],
        maxOutputBytes: 64 * 1024,
      })
    );
  }

  registration(): {
    readonly toolId: string;
    readonly manifest: ToolManifestDescription;
  } {
    return Object.freeze({ toolId: SKILL_LOAD_TOOL_ID, manifest: this.#manifest });
  }

  async loadSkill(input: {
    readonly skillId: string;
    readonly resources?: readonly string[];
    readonly userSelected?: boolean;
  }): Promise<SkillToolResult> {
    const entry = this.#options.catalog.entry(input.skillId);
    if (entry === undefined) {
      return this.#error("SKILL_UNKNOWN", `No indexed skill "${input.skillId}".`);
    }
    if (!entry.enabled) {
      return this.#error(
        "SKILL_DISABLED",
        `The skill "${input.skillId}" is disabled and is not loaded.`
      );
    }
    const allowedTrusts = this.#options.allowedTrusts ?? DEFAULT_ALLOWED_TRUSTS;
    if (!allowedTrusts.includes(entry.trust) && input.userSelected !== true) {
      return this.#error(
        "SKILL_TRUST_REQUIRED",
        `The skill "${input.skillId}" comes from ${entry.trust} and needs the user to select it.`
      );
    }
    const instructions = await this.#options.catalog.loadInstructions(input.skillId);
    const maxBytes = this.#options.maxInstructionsBytes ?? 64 * 1024;
    if (utf8Bytes(instructions.text) > maxBytes) {
      return this.#error(
        "SKILL_INVALID",
        `The skill "${input.skillId}" is larger than ${maxBytes} bytes.`
      );
    }
    const resources: string[] = [];
    const resourceOutputs: { type: "text"; text: string }[] = [];
    const resourceDigests: { sourcePath: string; contentHash: string; bytes: number }[] = [];
    let loadedBytes = utf8Bytes(instructions.text);
    for (const resource of input.resources ?? []) {
      const relativePath = safeRelativePath(entry.dirPath, resource);
      if (relativePath === undefined) {
        return this.#error(
          "SKILL_RESOURCE_ESCAPE",
          `The resource "${resource}" escapes the skill directory.`,
          { resource }
        );
      }
      resources.push(relativePath);
      if (!this.#options.readResource)
        return this.#error("SKILL_INVALID", "The host cannot read skill resources.");
      const text = await this.#options.readResource({
        skillId: entry.skillId,
        relativePath: resource,
      });
      loadedBytes += utf8Bytes(text);
      // 资源必须实际读取并与正文共用大小上限，不能只返回路径冒充已加载。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (loadedBytes > maxBytes)
        return this.#error(
          "SKILL_INVALID",
          `The skill and requested resources exceed ${maxBytes} bytes.`
        );
      resourceOutputs.push({ type: "text", text });
      resourceDigests.push({
        sourcePath: relativePath,
        contentHash: sha256(text),
        bytes: utf8Bytes(text),
      });
    }
    return Object.freeze({
      isError: false,
      output: Object.freeze([
        { type: "text" as const, text: instructions.text },
        ...resourceOutputs,
      ]),
      details: Object.freeze({
        skillId: entry.skillId,
        contentHash: instructions.contentHash,
        scope: entry.scope,
        trust: entry.trust,
        ...(resources.length > 0 ? { resources: Object.freeze(resources) } : {}),
        ...(resourceDigests.length > 0 ? { resourceDigests: Object.freeze(resourceDigests) } : {}),
      }),
    });
  }

  describe(skillId: string): SkillToolResult {
    const entry = this.#options.catalog.entry(skillId);
    if (entry === undefined) {
      return this.#error("SKILL_UNKNOWN", `No indexed skill "${skillId}".`);
    }
    return Object.freeze({
      isError: false,
      output: Object.freeze([{ type: "text" as const, text: entry.description }]),
      details: Object.freeze({
        skillId: entry.skillId,
        name: entry.name,
        description: entry.description,
        scope: entry.scope,
        trust: entry.trust,
        enabled: entry.enabled,
        contentHash: entry.contentHash,
      }),
    });
  }

  async requestScriptRun(
    input: {
      readonly skillId: string;
      readonly command: string;
    },
    hostProcess = this.#options.hostProcess
  ): Promise<SkillToolResult> {
    const entry = this.#options.catalog.entry(input.skillId);
    if (entry === undefined) {
      return this.#error("SKILL_UNKNOWN", `No indexed skill "${input.skillId}".`);
    }
    if (!entry.enabled) {
      return this.#error("SKILL_DISABLED", `The skill "${input.skillId}" is disabled.`);
    }
    if (input.command.trim().length === 0) {
      return this.#error("SKILL_INVALID", "A script request needs a command.");
    }
    if (!hostProcess)
      return this.#error(
        "SKILL_SCRIPT_NOT_APPROVED",
        "The reviewed host-process service is unavailable."
      );
    const approval = await hostProcess.requestApproval({
      skillId: entry.skillId,
      command: input.command,
    });
    if (approval.result) return approval.result;
    if (!approval.approved) {
      return this.#error(
        "SKILL_SCRIPT_NOT_APPROVED",
        approval.reason ?? "The host did not approve this skill script.",
        { skillId: entry.skillId }
      );
    }
    return Object.freeze({
      isError: false,
      output: Object.freeze([
        {
          type: "text" as const,
          text: "The script was approved as a host process request; the host runs it.",
        },
      ]),
      details: Object.freeze({
        skillId: entry.skillId,
        ...(approval.requestId !== undefined ? { requestId: approval.requestId } : {}),
      }),
    });
  }

  #error(
    code: SkillToolErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ): SkillToolResult {
    return Object.freeze({
      isError: true,
      output: Object.freeze([{ type: "text" as const, text: message }]),
      details: Object.freeze({ errorCode: code, ...details }),
    });
  }
}

export function safeRelativePath(dirPath: string, resource: string): string | undefined {
  if (typeof resource !== "string" || resource.trim().length === 0) return undefined;
  const normalizedResource = resource.replace(/\\/g, "/");
  if (normalizedResource.startsWith("/") || /^[A-Za-z]:\//.test(normalizedResource))
    return undefined;
  const segments: string[] = [];
  for (const segment of normalizedResource.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") return undefined;
    segments.push(segment);
  }
  if (segments.length === 0) return undefined;
  const normalizedDir = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${normalizedDir}/${segments.join("/")}`;
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
