import type { UserMessage } from "@earendil-works/pi-ai";
import type { App } from "obsidian";
import type { PromptInput } from "@/agentMode/session/types";
import {
  buildContext,
  type BuiltContext,
  type ContextBuilderInput,
  type ContextSection,
  type ContextEnvironment,
  CONTEXT_MATERIAL_BYTES_PER_TOKEN,
} from "@/agentMode/sdk/pi/features/ContextBuilder";
import {
  Attachments,
  ATTACHMENT_MAX_BYTES,
  SUPPORTED_IMAGE_MIME,
  type AttachmentInput,
  type AttachmentRecord,
} from "@/agentMode/sdk/pi/features/Attachments";
import {
  CommandDispatcher,
  type CommandPorts,
  type CommandResult,
} from "@/agentMode/sdk/pi/features/CommandDispatcher";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { sha256 } from "@/utils/hash";
import { loadProjectInstructions } from "@/agentMode/sdk/pi/features/ProjectInstructions";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";

export interface PiRuntimeInputOptions {
  readonly input: PromptInput;
  readonly modelKey: string;
  readonly acceptsImages: boolean;
  readonly contextWindowTokens?: number | null;
  readonly privateDir: string;
  readonly vaultRoot?: string;
  readonly app: App;
  readonly isPathAllowed?: (path: string) => boolean;
  readonly environment?: Partial<ContextEnvironment>;
  readonly isInstructionPathAllowed?: (path: string) => boolean;
  readonly instructionContext?: Pick<
    ContextBuilderInput,
    "base" | "toolGuidance" | "userSystem" | "skills"
  >;
}
export interface PreparedPiRuntimeInput {
  readonly instructions: string;
  readonly content: Exclude<UserMessage["content"], string>;
  readonly receipt: {
    readonly requestId?: string;
    readonly userInput: string;
    readonly modelTextHash: string;
    readonly context: Omit<BuiltContext, "sections"> & {
      readonly sectionDigests: readonly Omit<ContextSection, "text">[];
    };
    readonly attachments: readonly AttachmentRecord[];
    readonly attachmentReceipts: string;
  };
  readonly notices: readonly string[];
}

// 资料和图片在真正请求前检查边界并保存来源，用户请求不能与外部材料混为指令：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function preparePiRuntimeInput(
  options: PiRuntimeInputOptions
): Promise<PreparedPiRuntimeInput> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const { Buffer } = requireNodeModule<typeof import("node:buffer")>("node:buffer");
  const userInput = options.input.prompt
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const environment: ContextEnvironment = {
    currentDate: new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(now),
    timeZone,
    capturedAt: now.toISOString(),
    scope: { vaultRoot: options.vaultRoot },
    model: {
      id: options.modelKey,
      acceptsImages: options.acceptsImages,
      contextWindowTokens: options.contextWindowTokens,
    },
    ...options.environment,
  };
  const resolver = options.vaultRoot
    ? new PathResolver({
        vaultRoot: options.vaultRoot,
        protectedRoots: [
          path.resolve(options.vaultRoot, options.app.vault.configDir),
          options.privateDir,
        ],
        fileSystem: {
          realpath: (target) => fs.realpath(target),
          stat: (target) => fs.stat(target, { bigint: true }),
        },
        path,
      })
    : null;
  const projectInstructions =
    options.vaultRoot && resolver
      ? await loadProjectInstructions({
          maxBytes: Math.min(
            32 * 1024,
            Math.floor(
              (options.contextWindowTokens ?? 200_000) * CONTEXT_MATERIAL_BYTES_PER_TOKEN * 0.25
            )
          ),
          workspaceRelativePath: path
            .relative(options.vaultRoot, environment.scope.workspaceRoot ?? options.vaultRoot)
            .split(path.sep)
            .join("/"),
          read: async (target, maxBytes) => {
            if (options.isInstructionPathAllowed?.(target) === false)
              throw new Error("Instruction source is excluded.");
            const resolved = await resolver.resolveVaultPath(target);
            const current = await resolver.revalidate(resolved);
            let handle: Awaited<ReturnType<typeof fs.open>>;
            try {
              handle = await fs.open(current.canonical, "r");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
              throw error;
            }
            try {
              const before = await handle.stat();
              const checked = await resolver.revalidate(current);
              const location = await fs.stat(checked.canonical);
              if (
                !before.isFile() ||
                before.size > maxBytes ||
                before.dev !== location.dev ||
                before.ino !== location.ino
              )
                throw new Error("Instruction source exceeds its size or identity boundary.");
              const data = Buffer.alloc(maxBytes + 1);
              const { bytesRead } = await handle.read(data, 0, data.length, 0);
              const after = await handle.stat();
              await resolver.revalidate(checked);
              if (
                bytesRead > maxBytes ||
                before.size !== after.size ||
                before.mtimeMs !== after.mtimeMs
              )
                throw new Error("Instruction source changed while reading.");
              return data.subarray(0, bytesRead).toString("utf8");
            } finally {
              await handle.close();
            }
          },
        })
      : undefined;
  const built = buildContext({
    ...options.instructionContext,
    base: options.instructionContext?.base ?? "",
    environment,
    projectInstructions: projectInstructions?.instructions,
    instructionNotices: projectInstructions?.notices,
    userInput,
    contextWindowTokens: options.contextWindowTokens ?? undefined,
    materials: options.input.context?.materials,
    ...(options.input.context?.project
      ? {
          project: {
            text: options.input.context.project.text,
            path: options.input.context.project.sourcePath,
          },
        }
      : {}),
  });
  const instructions = built.sections
    .filter((section) => section.injectedAsSystem && section.kind !== "user_input")
    .filter((section) => section.text.length > 0)
    .map(
      (section) =>
        `[${section.kind} source=${JSON.stringify(section.sourceId)} revision=${JSON.stringify(section.revision)} scope=${JSON.stringify(section.scope ?? "")} ]\n${section.text}`
    )
    .filter(Boolean)
    .join("\n\n");
  // 同一份有序 sections 决定实际指令与用户资料两路，外部笔记不能因字符串拼接晋升为系统权限。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const text = [
    ...built.sections
      .filter((section) => section.kind === "user_input" || section.kind === "material")
      .map((section) =>
        section.kind === "user_input"
          ? section.text
          : `\n<untrusted-material>\n${JSON.stringify({
              origin: section.origin,
              source: section.sourcePath ?? section.url ?? "",
              hash: section.contentHash,
              text: section.text,
            })
              .replace(/</g, "\\u003c")
              .replace(/>/g, "\\u003e")}\n</untrusted-material>`
      ),
    ...built.notices,
  ]
    .filter(Boolean)
    .join("\n\n");
  const directory = path.join(options.privateDir, "attachments");
  const vaultPorts = {
    isPathAllowed: (target: string) =>
      !!target &&
      !target.split(/[\\/]/).some((segment) => segment === ".." || segment === ".") &&
      !path.isAbsolute(target) &&
      target !== options.app.vault.configDir &&
      !target.startsWith(`${options.app.vault.configDir}/`) &&
      options.isPathAllowed?.(target) === true,
    read: async (target: string) => {
      try {
        if (!resolver || options.isPathAllowed?.(target) !== true) return undefined;
        const resolved = await resolver.resolveVaultPath(target);
        if (options.isPathAllowed?.(resolved.relative) !== true) return undefined;
        if ((await fs.stat(resolved.canonical)).size > ATTACHMENT_MAX_BYTES) return undefined;
        const current = await resolver.revalidate(resolved);
        if (options.isPathAllowed?.(current.relative) !== true) return undefined;
        const data = new Uint8Array(await options.app.vault.adapter.readBinary(current.relative));
        return decodeImage(Buffer.from(data).toString("base64"), mimeFromPath(target));
      } catch {
        return undefined;
      }
    },
  };
  const attachments = new Attachments({
    ports: {
      store: {
        save: async ({ mime, data }) => {
          const encoded = Buffer.from(data).toString("base64");
          const hash = sha256(encoded);
          await fs.mkdir(directory, { recursive: true, mode: 0o700 });
          await fs
            .writeFile(
              path.join(directory, `${hash}.json`),
              JSON.stringify({ mime, data: encoded }),
              { mode: 0o600, flag: "wx" }
            )
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "EEXIST") throw error;
            });
          return { blobRef: `image:${hash}` };
        },
        load: async (blobRef) => {
          const match = /^image:([a-f0-9]{64})$/.exec(blobRef);
          if (!match) return undefined;
          const file = path.join(directory, `${match[1]}.json`);
          try {
            if ((await fs.stat(file)).size > Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 1024)
              return undefined;
            const stored: unknown = JSON.parse(await fs.readFile(file, "utf8"));
            if (
              !isRecord(stored) ||
              typeof stored.mime !== "string" ||
              typeof stored.data !== "string" ||
              sha256(stored.data) !== match[1]
            )
              return undefined;
            const data = decodeImage(stored.data, stored.mime);
            return { mime: stored.mime, data };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            throw error;
          }
        },
      },
      vault: vaultPorts,
      modelCapability: (modelKey) => ({
        modelKey,
        acceptsImages: options.acceptsImages,
        supportedMime: SUPPORTED_IMAGE_MIME,
        maxImageBytes: ATTACHMENT_MAX_BYTES,
        maxImages: Number.MAX_SAFE_INTEGER,
      }),
    },
  });
  const inputs: AttachmentInput[] = [];
  const records: AttachmentRecord[] = [];
  for (const [index, part] of options.input.prompt.entries()) {
    if (part.type === "image") {
      if (!options.acceptsImages)
        throw new Error("The selected model does not support image attachments.");
      const data = decodeImage(part.data, part.mimeType);
      const record = await attachments.save({
        attachmentId: `image-${sha256(part.data)}`,
        mime: part.mimeType,
        data,
      });
      inputs.push(record);
      records.push(record);
    } else if (part.type === "resource_link") {
      const target = part.uri.startsWith("vault:")
        ? decodeURIComponent(part.uri.slice(6).replace(/^\/\//, ""))
        : "";
      const resource = {
        attachmentId: `resource-${index}`,
        mime: mimeFromPath(target),
        vaultPath: target,
        originalPath: part.name ?? part.uri,
      };
      const data =
        options.acceptsImages && vaultPorts.isPathAllowed(target)
          ? await vaultPorts.read(target)
          : undefined;
      if (data) {
        const record = await attachments.save({ ...resource, data });
        inputs.push(record);
        records.push(record);
      } else inputs.push(resource);
    }
  }
  for (const record of attachments.importReceipts(userInput)) {
    inputs.push(record);
    records.push(record);
  }
  const modelParts = await attachments.toModelMessage({
    modelKey: options.modelKey,
    attachments: inputs,
    text,
  });
  const content: Exclude<UserMessage["content"], string> = [];
  for (const part of modelParts) {
    if (part.type === "image" && part.data && part.mime)
      content.push({
        type: "image",
        mimeType: part.mime,
        data: Buffer.from(part.data).toString("base64"),
      });
    else content.push({ type: "text", text: part.text ?? "" });
  }
  const digest = {
    sectionDigests: built.sections.map(({ text: _text, ...metadata }) => metadata),
    materialBytes: built.materialBytes,
    materialBudgetBytes: built.materialBudgetBytes,
    materialDigest: built.materialDigest,
    omittedMaterials: built.omittedMaterials,
    notices: built.notices,
  };
  return {
    instructions,
    content,
    receipt: {
      requestId: options.input.requestId,
      userInput,
      modelTextHash: sha256(
        content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
      ),
      context: digest,
      attachments: records,
      attachmentReceipts: attachments.exportReceipts(records),
    },
    notices: built.notices,
  };
}

export async function dispatchPiRuntimeCommand(
  input: PromptInput,
  ports: CommandPorts
): Promise<CommandResult> {
  const text = input.prompt
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  if (/^\/compact(?:\s|$)/.test(text.trim())) return { handled: false, ok: false };
  return new CommandDispatcher({ ports }).dispatch({ sessionId: input.sessionId, text });
}

function decodeImage(encoded: string, mime: string): Uint8Array {
  const { Buffer } = requireNodeModule<typeof import("node:buffer")>("node:buffer");
  if (!SUPPORTED_IMAGE_MIME.includes(mime)) throw new Error("The image MIME type is unsupported.");
  if (encoded.length > Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 4)
    throw new Error("The image exceeds the 8 MiB attachment limit.");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error("The image data is not valid base64.");
  const data = Buffer.from(encoded, "base64");
  if (!data.byteLength || data.byteLength > ATTACHMENT_MAX_BYTES)
    throw new Error("The image exceeds the 8 MiB attachment limit or is empty.");
  const actual =
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
      ? "image/png"
      : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        ? "image/jpeg"
        : data.subarray(0, 3).toString() === "GIF"
          ? "image/gif"
          : data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP"
            ? "image/webp"
            : null;
  if (actual !== mime) throw new Error("The image data does not match its declared MIME type.");
  return Uint8Array.from(data);
}
function mimeFromPath(path: string): string {
  const extension = path.toLowerCase().split(".").pop();
  return extension === "png"
    ? "image/png"
    : extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "gif"
        ? "image/gif"
        : extension === "webp"
          ? "image/webp"
          : "application/octet-stream";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
