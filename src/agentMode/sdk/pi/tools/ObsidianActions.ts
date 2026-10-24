import { sha256 } from "@/utils/hash";
import { PathResolver, PathResolverError } from "@/agentMode/sdk/pi/policy/PathResolver";
import { defineToolManifest, type ToolManifest } from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import {
  captureSelectionSnapshot,
  decodeSelectionToken,
  encodeSelectionToken,
  offsetOf,
  selectionStillMatches,
  textAtRange,
  type EditorPosition,
  type EditorRange,
  type SelectionSnapshot,
} from "@/agentMode/sdk/pi/tools/SelectionSnapshot";

// Obsidian actions use the injected App (so popout windows do not reach for a global app), bind
// selections to leaf/file/content/range, re-verify the same view after approval, refuse unknown
// actions and command ids or JavaScript, keep unsaved buffers from being overwritten through the
// disk write path, and honour cancellation:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ObsidianEditor {
  getValue(): string;
  getSelection(): EditorRange;
  replaceRange?(text: string, from: EditorPosition, to: EditorPosition): void;
  replaceSelection?(text: string): void;
}

export interface ObsidianLeaf {
  readonly id: string;
  readonly view?: {
    readonly file?: { readonly path: string } | null;
    readonly editor?: ObsidianEditor;
  };
}

export interface ObsidianWorkspace {
  iterateAllLeaves(callback: (leaf: ObsidianLeaf) => void): void;
  getLeaf?(newLeaf?: boolean): ObsidianLeaf;
  openFile(filePath: string, line?: number): Promise<void>;
}

export interface ObsidianApp {
  readonly workspace: ObsidianWorkspace;
}

export interface ObsidianActionsOptions {
  readonly app: ObsidianApp;
  readonly pathResolver: PathResolver;
  readonly vault: { read(path: string): Promise<string> };
  readonly registeredActions?: readonly string[];
  readonly now?: () => number;
}

export type ObsidianActionErrorCode =
  | "INVALID_ARGUMENT"
  | "NO_ACTIVE_EDITOR"
  | "SELECTION_CHANGED"
  | "LEAF_GONE"
  | "OPEN_BUFFER_CONFLICT"
  | "CANCELLED"
  | "PATH_OUT_OF_SCOPE"
  | "PROTECTED_PATH"
  | "READ_FAILED"
  | "ACTION_FAILED";

export interface ObsidianActionFailure {
  readonly ok: false;
  readonly code: ObsidianActionErrorCode;
  readonly message: string;
}

export type GetSelectionResult =
  | {
      readonly ok: true;
      readonly selectionToken: string;
      readonly snapshot: SelectionSnapshot;
      readonly text: string;
    }
  | ObsidianActionFailure;

export type ReplaceSelectionResult =
  | { readonly ok: true; readonly filePath: string; readonly newContentHash: string }
  | ObsidianActionFailure;

export type SelectionReplacementPreview =
  | {
      readonly ok: true;
      readonly filePath: string;
      readonly before: string;
      readonly after: string;
    }
  | ObsidianActionFailure;

interface PreparedSelectionReplacement {
  readonly ok: true;
  readonly editor: ObsidianEditor;
  readonly snapshot: SelectionSnapshot;
  readonly filePath: string;
  readonly before: string;
  readonly after: string;
}

export type OpenNoteResult = { readonly ok: true; readonly path: string } | ObsidianActionFailure;

export type RunActionResult =
  | { readonly ok: true; readonly action: string }
  | ObsidianActionFailure;

export type OpenBufferCheckResult = { readonly ok: true } | ObsidianActionFailure;

export interface ObsidianActionContext {
  readonly signal?: AbortSignal;
  readonly isPathInScope?: (relativePath: string) => boolean;
}

const OPEN_NOTE_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    line: { type: "integer", minimum: 0 },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

const GET_SELECTION_PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const REPLACE_SELECTION_PARAMETERS = {
  type: "object",
  properties: {
    selectionToken: { type: "string", minLength: 1, maxLength: 8_192 },
    text: { type: "string", maxLength: 100_000 },
  },
  required: ["selectionToken", "text"],
  additionalProperties: false,
} as const;

const ACTION_PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["open_note"] },
    payload: { type: "object" },
  },
  required: ["action"],
  additionalProperties: false,
} as const;

const ACTION_ALLOWED_KEYS: ReadonlySet<string> = new Set(["action", "payload"]);

export class ObsidianActions {
  readonly manifests: readonly ToolManifest[];
  private readonly app: ObsidianApp;
  private readonly pathResolver: PathResolver;
  private readonly vault: ObsidianActionsOptions["vault"];
  private readonly registeredActions: readonly string[];
  private readonly now: () => number;

  constructor(options: ObsidianActionsOptions) {
    this.app = options.app;
    this.pathResolver = options.pathResolver;
    this.vault = options.vault;
    this.registeredActions = options.registeredActions ?? [];
    this.now = options.now ?? Date.now;
    this.manifests = Object.freeze([
      defineToolManifest({
        toolId: "obsidian_open_note",
        description:
          "Open an authorized vault note in Obsidian, optionally at a line. Opening a note does not read its content or modify it.",
        family: "obsidian_action",
        effects: ["ui"],
        parameters: OPEN_NOTE_PARAMETERS,
        extractTargets: () => [],
        implementationVersion: 1,
        schemaVersion: 1,
        replayPolicy: "idempotent",
        allowedCallers: ["root", "subagent"],
        maxOutputBytes: 64 * 1_024,
      }),
      defineToolManifest({
        toolId: "obsidian_get_selection",
        description:
          "Read the current editor selection and its versioned snapshot. An empty selection is not the whole note. Use the snapshot for selection replacement.",
        family: "obsidian_action",
        effects: ["read"],
        parameters: GET_SELECTION_PARAMETERS,
        extractTargets: () => [],
        implementationVersion: 1,
        schemaVersion: 1,
        replayPolicy: "read_only",
        allowedCallers: ["root", "subagent"],
        maxOutputBytes: 64 * 1_024,
      }),
      defineToolManifest({
        toolId: "obsidian_replace_selection",
        description:
          "Replace the exact previously observed editor selection after approval. Editor and file baselines are revalidated; changed selection requires a fresh snapshot. Success includes a persisted modification receipt.",
        family: "obsidian_action",
        effects: ["state"],
        parameters: REPLACE_SELECTION_PARAMETERS,
        // 选区凭据中的真实文件也必须进入审批目标，不能只展示一段无法核对的凭据。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        extractTargets: (args) => {
          const token = (args as { selectionToken?: unknown } | null)?.selectionToken;
          const snapshot = typeof token === "string" ? decodeSelectionToken(token) : null;
          return snapshot ? [{ kind: "vault_path", value: snapshot.filePath }] : [];
        },
        implementationVersion: 1,
        schemaVersion: 1,
        replayPolicy: "unsafe",
        allowedCallers: ["root"],
        maxOutputBytes: 64 * 1_024,
      }),
      defineToolManifest({
        toolId: "obsidian_action",
        description:
          "Run an explicitly registered Obsidian action within the current authorized scope. This is not an unrestricted command runner; inspect the result before claiming completion.",
        family: "obsidian_action",
        effects: ["ui", "state"],
        parameters: ACTION_PARAMETERS,
        extractTargets: () => [],
        implementationVersion: 1,
        schemaVersion: 1,
        replayPolicy: "unsafe",
        allowedCallers: ["root"],
        maxOutputBytes: 64 * 1_024,
      }),
    ]);
  }

  register(registry: ToolRegistry, gateway?: ToolGateway): void {
    for (const manifest of this.manifests) {
      registry.register(manifest, "host");
      gateway?.registerTool({
        toolId: manifest.toolId,
        manifest,
        execute: async (args) => {
          const result = await this.dispatch(manifest.toolId, args, {});
          return { content: JSON.stringify(result), isError: result.ok === false };
        },
      });
    }
  }

  async getSelection(
    _rawArgs: Record<string, unknown>,
    _context: ObsidianActionContext
  ): Promise<GetSelectionResult> {
    const state = this.activeSelectionState();
    if (state === null) {
      return failure(
        "NO_ACTIVE_EDITOR",
        "There is no active Markdown editor to read a selection from."
      );
    }
    const snapshot = captureSelectionSnapshot(state, this.now());
    return {
      ok: true,
      selectionToken: encodeSelectionToken(snapshot),
      snapshot,
      text: state.selectedText,
    };
  }

  async replaceSelection(
    rawArgs: Record<string, unknown>,
    context: ObsidianActionContext
  ): Promise<ReplaceSelectionResult> {
    const prepared = this.prepareSelectionReplacement(rawArgs, context);
    if (!prepared.ok) return prepared;
    const { editor, snapshot } = prepared;
    if (isAborted(context)) {
      return failure("CANCELLED", "The selection replace was cancelled before writing.");
    }
    if (editor.replaceRange !== undefined) {
      editor.replaceRange(rawArgs.text as string, snapshot.from, snapshot.to);
    } else if (editor.replaceSelection !== undefined) {
      editor.replaceSelection(rawArgs.text as string);
    } else {
      return failure("ACTION_FAILED", "The editor does not support range replacement.");
    }
    return { ok: true, filePath: prepared.filePath, newContentHash: sha256(editor.getValue()) };
  }

  previewSelectionReplacement(
    rawArgs: Record<string, unknown>,
    context: ObsidianActionContext
  ): SelectionReplacementPreview {
    const prepared = this.prepareSelectionReplacement(rawArgs, context);
    if (!prepared.ok) return prepared;
    return {
      ok: true,
      filePath: prepared.filePath,
      before: prepared.before,
      after: prepared.after,
    };
  }

  private prepareSelectionReplacement(
    rawArgs: Record<string, unknown>,
    context: ObsidianActionContext
  ): PreparedSelectionReplacement | ObsidianActionFailure {
    const token = rawArgs.selectionToken;
    const text = rawArgs.text;
    if (typeof token !== "string" || token.length === 0) {
      return failure("INVALID_ARGUMENT", "selectionToken is required.");
    }
    if (typeof text !== "string") return failure("INVALID_ARGUMENT", "text is required.");
    const snapshot = decodeSelectionToken(token);
    if (snapshot === null) {
      return failure(
        "INVALID_ARGUMENT",
        "The selection token is invalid; read the selection again."
      );
    }
    if (isAborted(context)) {
      return failure("CANCELLED", "The selection replace was cancelled before writing.");
    }
    const leaf = this.findLeaf(snapshot.leafId);
    if (leaf === undefined) {
      return failure("LEAF_GONE", "The editor view that owned this selection is gone.");
    }
    const state = this.selectionStateOf(leaf);
    if (state === null || !selectionStillMatches(snapshot, state)) {
      return failure(
        "SELECTION_CHANGED",
        "The editor content, file or selection changed after approval; read it again."
      );
    }
    const editor = leaf.view?.editor;
    if (editor === undefined) {
      return failure("ACTION_FAILED", "The editor is not available.");
    }
    const start = offsetOf(state.content, snapshot.from);
    const end = offsetOf(state.content, snapshot.to);
    return {
      ok: true,
      editor,
      snapshot,
      filePath: state.filePath,
      before: state.content,
      after:
        state.content.slice(0, Math.min(start, end)) +
        text +
        state.content.slice(Math.max(start, end)),
    };
  }

  async openNote(
    rawArgs: Record<string, unknown>,
    context: ObsidianActionContext
  ): Promise<OpenNoteResult> {
    const requestedPath = rawArgs.path;
    if (typeof requestedPath !== "string" || requestedPath.length === 0) {
      return failure("INVALID_ARGUMENT", "path is required.");
    }
    const line = rawArgs.line;
    if (line !== undefined && (!Number.isInteger(line) || (line as number) < 0)) {
      return failure("INVALID_ARGUMENT", "line must be a non-negative integer.");
    }
    const resolved = await this.resolve(requestedPath, context);
    if (!resolved.ok) return resolved;
    try {
      await this.app.workspace.openFile(
        resolved.relative,
        line === undefined ? undefined : (line as number)
      );
    } catch {
      return failure("ACTION_FAILED", "Obsidian could not open the note.");
    }
    return { ok: true, path: resolved.relative };
  }

  async runAction(
    rawArgs: Record<string, unknown>,
    context: ObsidianActionContext
  ): Promise<RunActionResult> {
    const action = rawArgs.action;
    if (typeof action !== "string" || action.length === 0) {
      return failure("INVALID_ARGUMENT", "action is required.");
    }
    for (const key of Object.keys(rawArgs)) {
      if (!ACTION_ALLOWED_KEYS.has(key)) {
        return failure("INVALID_ARGUMENT", `Unsupported action argument "${key}".`);
      }
    }
    if (action !== "open_note") {
      return failure(
        "INVALID_ARGUMENT",
        `The action "${action}" is not a registered public action.`
      );
    }
    if (!this.registeredActions.includes(action)) {
      return failure("INVALID_ARGUMENT", `The action "${action}" is not registered by the host.`);
    }
    const payload = rawArgs.payload;
    if (
      payload !== undefined &&
      (typeof payload !== "object" || payload === null || Array.isArray(payload))
    ) {
      return failure("INVALID_ARGUMENT", "payload must be an object.");
    }
    const opened = await this.openNote((payload ?? {}) as Record<string, unknown>, context);
    if (!opened.ok) return opened;
    return { ok: true, action };
  }

  async checkOpenBuffer(filePath: string): Promise<OpenBufferCheckResult> {
    const leaves = this.leaves().filter(
      (candidate) => candidate.view?.file?.path === filePath && candidate.view?.editor !== undefined
    );
    if (leaves.length === 0) return { ok: true };
    let disk: string;
    try {
      disk = await this.vault.read(filePath);
    } catch {
      return failure("READ_FAILED", `Cannot read "${filePath}".`);
    }
    const diskHash = sha256(disk);
    // 同一笔记可在多个窗口打开，只检查第一个已保存窗口会漏过其他窗口的未保存输入。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (
      leaves.some((leaf) => leaf.view?.editor && sha256(leaf.view.editor.getValue()) !== diskHash)
    ) {
      return failure(
        "OPEN_BUFFER_CONFLICT",
        "The note has unsaved editor content; save all open editors for this note before changing it."
      );
    }
    return { ok: true };
  }

  private async dispatch(
    toolId: string,
    args: Record<string, unknown>,
    context: ObsidianActionContext
  ): Promise<{ ok: boolean }> {
    if (toolId === "obsidian_open_note") return this.openNote(args, context);
    if (toolId === "obsidian_get_selection") return this.getSelection(args, context);
    if (toolId === "obsidian_replace_selection") return this.replaceSelection(args, context);
    return this.runAction(args, context);
  }

  private leaves(): readonly ObsidianLeaf[] {
    const leaves: ObsidianLeaf[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      leaves.push(leaf);
    });
    return leaves;
  }

  private findLeaf(leafId: string): ObsidianLeaf | undefined {
    return this.leaves().find((leaf) => leaf.id === leafId);
  }

  private activeSelectionState(): SelectionState | null {
    for (const leaf of this.leaves()) {
      const state = this.selectionStateOf(leaf);
      if (state !== null) return state;
    }
    return null;
  }

  private selectionStateOf(leaf: ObsidianLeaf): SelectionState | null {
    const filePath = leaf.view?.file?.path;
    const editor = leaf.view?.editor;
    if (filePath === undefined || editor === undefined) return null;
    const content = editor.getValue();
    const selection = editor.getSelection();
    return {
      leafId: leaf.id,
      filePath,
      content,
      selection,
      selectedText: textAtRange(content, selection.from, selection.to),
    };
  }

  private async resolve(
    requested: string,
    context: ObsidianActionContext
  ): Promise<{ readonly ok: true; readonly relative: string } | ObsidianActionFailure> {
    try {
      const resolved = await this.pathResolver.resolveVaultPath(requested);
      if (context.isPathInScope !== undefined && !context.isPathInScope(resolved.relative)) {
        return failure(
          "PATH_OUT_OF_SCOPE",
          `The path "${requested}" is outside the approved Vault scope.`
        );
      }
      return { ok: true, relative: resolved.relative };
    } catch (error) {
      if (error instanceof PathResolverError) {
        if (error.code === "PROTECTED_PATH") return failure("PROTECTED_PATH", error.message);
        if (error.code === "INVALID_ARGUMENT") return failure("INVALID_ARGUMENT", error.message);
        return failure(
          "PATH_OUT_OF_SCOPE",
          `The path "${requested}" is outside the approved Vault scope.`
        );
      }
      return failure("READ_FAILED", `Cannot resolve "${requested}".`);
    }
  }
}

interface SelectionState {
  readonly leafId: string;
  readonly filePath: string;
  readonly content: string;
  readonly selection: EditorRange;
  readonly selectedText: string;
}

function isAborted(context: ObsidianActionContext): boolean {
  return context.signal?.aborted === true;
}

function failure(code: ObsidianActionErrorCode, message: string): ObsidianActionFailure {
  return { ok: false, code, message };
}
