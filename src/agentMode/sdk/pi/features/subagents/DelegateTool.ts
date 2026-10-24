import {
  DELEGATE_TOOL_NAME,
  SubagentProfileError,
  validateSubagentRequest,
  subagentProfileSchema,
  subagentModelSchema,
  type SubagentModelChoice,
  type SubagentProfileId,
} from "@/agentMode/sdk/pi/features/subagents/Profiles";
import {
  computeSubagentScope,
  type SubagentScope,
  type SubagentScopeParent,
  type SubagentScopePolicy,
} from "@/agentMode/sdk/pi/features/subagents/SubagentScope";
import {
  defineToolManifest,
  describeToolManifest,
  type ToolManifestDescription,
  type ToolManifest,
} from "@/agentMode/sdk/pi/policy/ToolManifest";

// delegate_task is the recoverable foreground delegation tool: inside the commit it looks up an owned
// child by ownerTaskId and only creates one when none exists, initializes it with the reduced
// profile/scope, submits with the stable requestId `delegate:<taskId>` and waits. A reopen reuses the
// same child and submission, an unanswered child is a real failure instead of a text "done", a parent
// stop cancels the child, and the card receives the real assistant answer:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const DELEGATE_REQUEST_PREFIX = "delegate:";

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export interface DelegateChildRef {
  readonly conversationId: string;
  readonly ownerTaskId: string;
  readonly profileId: SubagentProfileId;
  readonly createdAtMs: number;
}

export interface DelegateSessionPort {
  findChild(ownerTaskId: string): Promise<DelegateChildRef | undefined>;
  createChild(input: {
    readonly ownerTaskId: string;
    readonly parentConversationId: string;
    readonly profileId: SubagentProfileId;
    readonly scope: SubagentScope;
    readonly modelKey: string;
    readonly instructions: string;
    readonly tools: readonly string[];
  }): Promise<DelegateChildRef>;
  writeChildMapping(child: DelegateChildRef): Promise<void>;
  submit(input: {
    readonly conversationId: string;
    readonly requestId: string;
    readonly task: string;
    readonly description: string;
    readonly inputFiles: readonly string[];
  }): Promise<void>;
  wait(input: {
    readonly conversationId: string;
    readonly requestId: string;
    readonly signal?: AbortSignal;
  }): Promise<"completed" | "failed" | "cancelled" | "timeout">;
  readAnswer(input: {
    readonly conversationId: string;
    readonly requestId: string;
  }): Promise<{ readonly answered: boolean; readonly text: string; readonly entryId?: string }>;
  cancel(input: { readonly conversationId: string; readonly requestId: string }): Promise<void>;
}

export type DelegateErrorCode =
  | "SUBAGENT_DELEGATE_FAILED"
  | "SUBAGENT_CANCELLED"
  | "SUBAGENT_UNANSWERED"
  | "SUBAGENT_PROFILE_INVALID";

export interface DelegateToolRequest {
  readonly profileId: string;
  readonly task: string;
  readonly description: string;
  readonly inputFiles?: readonly string[];
  readonly modelKey?: string;
  readonly signal?: AbortSignal;
}

export interface DelegateProgressUpdate {
  readonly childConversationId: string;
  readonly profileId: SubagentProfileId;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly turns: number;
}

export interface DelegateToolDetails {
  readonly childConversationId: string;
  readonly profileId: SubagentProfileId;
  readonly status: "completed" | "failed" | "cancelled";
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly turns: number;
  readonly answerEntryId?: string;
  readonly tools: readonly string[];
  readonly errorCode?: DelegateErrorCode;
}

export interface DelegateToolResult {
  readonly isError: boolean;
  readonly output: readonly { readonly type: "text"; readonly text: string }[];
  readonly details: DelegateToolDetails;
}

export interface DelegateToolOptions {
  readonly session: DelegateSessionPort;
  readonly parent: SubagentScopeParent & {
    readonly conversationId: string;
    readonly taskId: string;
  };
  readonly policy?: SubagentScopePolicy;
  readonly knownModels?: readonly (string | SubagentModelChoice)[];
  readonly enabledProfiles?: readonly string[];
  readonly now?: () => number;
  readonly onUpdate?: (update: DelegateProgressUpdate) => void;
}

export class DelegateTool {
  readonly #options: DelegateToolOptions;
  readonly #manifest: ToolManifest;
  #turns = 0;

  constructor(options: DelegateToolOptions) {
    this.#options = options;
    this.#manifest = defineToolManifest({
      toolId: DELEGATE_TOOL_NAME,
      family: "control",
      effects: ["state"],
      parameters: {
        type: "object",
        properties: {
          profileId: subagentProfileSchema(options.enabledProfiles),
          task: { type: "string" },
          description: { type: "string" },
          inputFiles: { type: "array", items: { type: "string" } },
          outputPaths: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact vault paths this child may write or create; input files grant read access only.",
          },
          modelKey: subagentModelSchema(options.knownModels),
        },
        required: ["profileId", "task", "description"],
      },
      extractTargets: () => [{ kind: "operation", value: DELEGATE_TOOL_NAME }],
      implementationVersion: 1,
      schemaVersion: 1,
      replayPolicy: "idempotent",
      allowedCallers: ["root", "subagent"],
      maxOutputBytes: 32 * 1024,
    });
  }

  registration(): {
    readonly name: string;
    readonly vendorToolName: "Agent";
    readonly replay: "safe";
    readonly callers: readonly ["model"];
    readonly manifest: ToolManifestDescription;
    readonly parameters: Record<string, unknown>;
  } {
    return Object.freeze({
      name: DELEGATE_TOOL_NAME,
      vendorToolName: "Agent" as const,
      replay: "safe" as const,
      callers: Object.freeze(["model"] as const),
      manifest: describeToolManifest(this.#manifest),
      parameters: this.#manifest.parameters,
    });
  }

  async executeTool(request: DelegateToolRequest): Promise<DelegateToolResult> {
    const startedAtMs = this.#now();
    let validated;
    try {
      validated = validateSubagentRequest({
        profileId: request.profileId,
        ...(request.modelKey !== undefined ? { modelKey: request.modelKey } : {}),
        ...(this.#options.knownModels !== undefined
          ? {
              knownModels: this.#options.knownModels.map((model) =>
                typeof model === "string" ? model : model.modelKey
              ),
            }
          : {}),
        ...(this.#options.enabledProfiles !== undefined
          ? { enabledProfiles: this.#options.enabledProfiles }
          : {}),
      });
    } catch (thrown) {
      const message = thrown instanceof SubagentProfileError ? thrown.message : "Invalid profile.";
      return this.#failure("SUBAGENT_PROFILE_INVALID", message, startedAtMs, []);
    }
    const scope = computeSubagentScope({
      parent: this.#options.parent,
      profile: validated.profile,
      toolAllowlist: validated.toolAllowlist,
      ...(this.#options.policy !== undefined ? { policy: this.#options.policy } : {}),
    });
    const child = await this.#ensureChild(
      validated.profile.profileId,
      validated.instructions,
      scope,
      validated.modelKey
    );
    const requestId = `${DELEGATE_REQUEST_PREFIX}${this.#options.parent.taskId}`;
    this.#turns += 1;
    this.#emit({
      childConversationId: child.conversationId,
      profileId: child.profileId,
      status: "running",
      startedAtMs,
      turns: this.#turns,
    });
    await this.#options.session.submit({
      conversationId: child.conversationId,
      requestId,
      task: request.task,
      description: request.description,
      inputFiles: Object.freeze([...(request.inputFiles ?? [])]),
    });
    if (isAborted(request.signal)) {
      await this.#options.session.cancel({ conversationId: child.conversationId, requestId });
      return this.#cancelled(child, startedAtMs, scope.tools);
    }
    const status = await this.#options.session.wait({
      conversationId: child.conversationId,
      requestId,
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
    });
    if (status === "cancelled" || isAborted(request.signal)) {
      await this.#options.session.cancel({ conversationId: child.conversationId, requestId });
      return this.#cancelled(child, startedAtMs, scope.tools);
    }
    if (status !== "completed") {
      return this.#failure(
        "SUBAGENT_DELEGATE_FAILED",
        `The subagent ${status === "timeout" ? "timed out" : "failed"} before answering.`,
        startedAtMs,
        scope.tools,
        child
      );
    }
    const answer = await this.#options.session.readAnswer({
      conversationId: child.conversationId,
      requestId,
    });
    if (answer.answered !== true) {
      return this.#failure(
        "SUBAGENT_UNANSWERED",
        "The subagent finished without a real assistant answer; nothing was produced.",
        startedAtMs,
        scope.tools,
        child
      );
    }
    const endedAtMs = this.#now();
    const details: DelegateToolDetails = Object.freeze({
      childConversationId: child.conversationId,
      profileId: child.profileId,
      status: "completed" as const,
      startedAtMs,
      endedAtMs,
      turns: this.#turns,
      ...(answer.entryId !== undefined ? { answerEntryId: answer.entryId } : {}),
      tools: Object.freeze([...scope.tools]),
    });
    this.#emit({
      childConversationId: child.conversationId,
      profileId: child.profileId,
      status: "completed",
      startedAtMs,
      endedAtMs,
      turns: this.#turns,
    });
    return Object.freeze({
      isError: false,
      output: Object.freeze([{ type: "text" as const, text: answer.text }]),
      details,
    });
  }

  async #ensureChild(
    profileId: SubagentProfileId,
    instructions: string,
    scope: SubagentScope,
    modelKey: string | null
  ): Promise<DelegateChildRef> {
    const ownerTaskId = this.#options.parent.taskId;
    const existing = await this.#options.session.findChild(ownerTaskId);
    if (existing !== undefined) return existing;
    const child = await this.#options.session.createChild({
      ownerTaskId,
      parentConversationId: this.#options.parent.conversationId,
      profileId,
      scope,
      modelKey: modelKey ?? this.#options.parent.modelKey,
      instructions,
      tools: scope.tools,
    });
    await this.#options.session.writeChildMapping(child);
    return child;
  }

  #cancelled(
    child: DelegateChildRef,
    startedAtMs: number,
    tools: readonly string[]
  ): DelegateToolResult {
    const endedAtMs = this.#now();
    this.#emit({
      childConversationId: child.conversationId,
      profileId: child.profileId,
      status: "cancelled",
      startedAtMs,
      endedAtMs,
      turns: this.#turns,
    });
    return Object.freeze({
      isError: true,
      output: Object.freeze([{ type: "text" as const, text: "The subagent was cancelled." }]),
      details: Object.freeze({
        childConversationId: child.conversationId,
        profileId: child.profileId,
        status: "cancelled" as const,
        startedAtMs,
        endedAtMs,
        turns: this.#turns,
        tools: Object.freeze([...tools]),
        errorCode: "SUBAGENT_CANCELLED" as const,
      }),
    });
  }

  #failure(
    errorCode: DelegateErrorCode,
    message: string,
    startedAtMs: number,
    tools: readonly string[],
    child?: DelegateChildRef
  ): DelegateToolResult {
    const endedAtMs = this.#now();
    const profileId = child?.profileId ?? "researcher";
    if (child !== undefined) {
      this.#emit({
        childConversationId: child.conversationId,
        profileId,
        status: "failed",
        startedAtMs,
        endedAtMs,
        turns: this.#turns,
      });
    }
    return Object.freeze({
      isError: true,
      output: Object.freeze([{ type: "text" as const, text: message }]),
      details: Object.freeze({
        childConversationId: child?.conversationId ?? "",
        profileId,
        status: "failed" as const,
        startedAtMs,
        endedAtMs,
        turns: this.#turns,
        tools: Object.freeze([...tools]),
        errorCode,
      }),
    });
  }

  #emit(update: DelegateProgressUpdate): void {
    this.#options.onUpdate?.(Object.freeze(update));
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}
