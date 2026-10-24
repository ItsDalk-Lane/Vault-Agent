import {
  subagentProfileSchema,
  subagentModelSchema,
  type SubagentModelChoice,
} from "@/agentMode/sdk/pi/features/subagents/Profiles";
import {
  defineToolManifest,
  describeToolManifest,
  type ToolManifestDescription,
} from "@/agentMode/sdk/pi/policy/ToolManifest";

// The five background control tools act only on children owned by the current root, keep the start
// and send commandIds stable so a replay never duplicates a child or a message, mark stop as unsafe
// so recovery cannot stop a newer run, expose queued/running/terminal with a viewable child
// reference, and never fake a success for a result that does not exist yet:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1

export type SubagentControlStatus = "queued" | "running" | "terminal";

export interface SubagentStatusView {
  readonly taskId: string;
  readonly rootId: string;
  readonly profileId: string;
  readonly status: SubagentControlStatus;
  readonly childConversationId: string;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
  readonly resultRef?: string;
}

export interface SubagentControlPort {
  start(input: {
    readonly profileId: string;
    readonly task: string;
    readonly description: string;
    readonly inputFiles: readonly string[];
    readonly outputPaths?: readonly string[];
    readonly modelKey?: string;
    readonly commandId: string;
    readonly rootId: string;
    readonly ownerTaskId: string;
    readonly parentRunId: string;
  }): Promise<SubagentStatusView>;
  status(taskId: string): Promise<SubagentStatusView | undefined>;
  list(rootId: string): Promise<readonly SubagentStatusView[]>;
  stop(taskId: string): Promise<SubagentStatusView>;
  result(
    taskId: string
  ): Promise<
    { readonly answered: boolean; readonly text: string; readonly entryId?: string } | undefined
  >;
}

export type SubagentControlErrorCode =
  | "SUBAGENT_CONTROL_FOREIGN_ROOT"
  | "SUBAGENT_CONTROL_UNKNOWN_TASK"
  | "SUBAGENT_CONTROL_RESULT_NOT_READY";

export interface SubagentControlResult {
  readonly isError: boolean;
  readonly output: readonly { readonly type: "text"; readonly text: string }[];
  readonly details: Readonly<Record<string, unknown>>;
}

export interface SubagentControlToolsOptions {
  readonly port: SubagentControlPort;
  readonly rootId: string;
  readonly enabledProfiles?: readonly string[];
  readonly knownModels?: readonly (string | SubagentModelChoice)[];
}

interface ControlRegistration {
  readonly toolId: string;
  readonly replayPolicy: "read_only" | "idempotent" | "unsafe";
  readonly parameters: Record<string, unknown>;
  readonly manifest: ToolManifestDescription;
}

const TOOL_IDS = [
  "start_background_task",
  "get_subagent_result",
  "send_subagent_message",
  "stop_subagent",
  "list_subagents",
] as const;

export class SubagentControlTools {
  readonly #options: SubagentControlToolsOptions;
  readonly #registrations: readonly ControlRegistration[];

  constructor(options: SubagentControlToolsOptions) {
    this.#options = options;
    this.#registrations = Object.freeze(
      TOOL_IDS.map((toolId) => {
        const replayPolicy =
          toolId === "stop_subagent"
            ? ("unsafe" as const)
            : toolId === "get_subagent_result" || toolId === "list_subagents"
              ? ("read_only" as const)
              : ("idempotent" as const);
        const parameters =
          toolId === "start_background_task"
            ? {
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
                  commandId: { type: "string" },
                },
                required: ["profileId", "task", "description", "commandId"],
              }
            : toolId === "send_subagent_message"
              ? {
                  type: "object",
                  properties: {
                    taskId: { type: "string" },
                    message: { type: "string" },
                    commandId: { type: "string" },
                    wake: {
                      type: "boolean",
                      description:
                        "Explicitly start a follow-up for an idle child; omitted messages are stored without starting a new model request.",
                    },
                  },
                  required: ["taskId", "message", "commandId"],
                }
              : toolId === "stop_subagent" || toolId === "get_subagent_result"
                ? {
                    type: "object",
                    properties: { taskId: { type: "string" } },
                    required: ["taskId"],
                  }
                : { type: "object", properties: {} };
        return Object.freeze({
          toolId,
          replayPolicy,
          parameters,
          manifest: describeToolManifest(
            defineToolManifest({
              toolId,
              family: "control",
              effects: ["state"],
              parameters,
              extractTargets: () => [{ kind: "operation", value: toolId }],
              implementationVersion: 1,
              schemaVersion: 1,
              replayPolicy,
              allowedCallers: toolId === "send_subagent_message" ? ["root", "subagent"] : ["root"],
              maxOutputBytes: 32 * 1024,
            })
          ),
        });
      })
    );
  }

  registrations(): readonly {
    readonly toolId: string;
    readonly replayPolicy: "read_only" | "idempotent" | "unsafe";
    readonly manifest: ToolManifestDescription;
    readonly parameters: Record<string, unknown>;
  }[] {
    return Object.freeze(
      this.#registrations.map((entry) =>
        Object.freeze({
          toolId: entry.toolId,
          replayPolicy: entry.replayPolicy,
          manifest: entry.manifest,
          parameters: entry.parameters,
        })
      )
    );
  }

  async getSubagentResult(input: { readonly taskId: string }): Promise<SubagentControlResult> {
    const view = await this.#ownedStatus(input.taskId);
    if ("isError" in view) return view;
    const result = await this.#options.port.result(input.taskId);
    if (result === undefined || result.answered !== true) {
      return this.#error(
        "SUBAGENT_CONTROL_RESULT_NOT_READY",
        `The background subagent ${input.taskId} has no answer yet (status: ${view.status}).`,
        { taskId: input.taskId, status: view.status }
      );
    }
    return Object.freeze({
      isError: false,
      output: Object.freeze([{ type: "text" as const, text: result.text }]),
      details: Object.freeze({
        taskId: view.taskId,
        status: view.status,
        childConversationId: view.childConversationId,
        ...(result.entryId !== undefined ? { answerEntryId: result.entryId } : {}),
      }),
    });
  }

  async stopSubagent(input: { readonly taskId: string }): Promise<SubagentControlResult> {
    const view = await this.#ownedStatus(input.taskId);
    if ("isError" in view) return view;
    const stopped = await this.#options.port.stop(input.taskId);
    return this.#statusResult(stopped, `Background subagent ${input.taskId} stopped.`);
  }

  async listSubagents(): Promise<SubagentControlResult> {
    const owned = await this.#options.port.list(this.#options.rootId);
    const all = owned.filter((view) => view.rootId === this.#options.rootId);
    return Object.freeze({
      isError: false,
      output: Object.freeze([
        {
          type: "text" as const,
          text:
            all.length === 0
              ? "No background subagents are owned by this root."
              : all.map((view) => `${view.taskId} · ${view.profileId} · ${view.status}`).join("\n"),
        },
      ]),
      details: Object.freeze({
        count: all.length,
        subagents: Object.freeze(
          all.map((view) =>
            Object.freeze({
              taskId: view.taskId,
              profileId: view.profileId,
              status: view.status,
              childConversationId: view.childConversationId,
            })
          )
        ),
      }),
    });
  }

  async #ownedStatus(taskId: string): Promise<SubagentStatusView | SubagentControlResult> {
    const view = await this.#options.port.status(taskId);
    if (view === undefined) {
      return this.#error("SUBAGENT_CONTROL_UNKNOWN_TASK", `No background subagent "${taskId}".`, {
        taskId,
      });
    }
    if (view.rootId !== this.#options.rootId) {
      return this.#error(
        "SUBAGENT_CONTROL_FOREIGN_ROOT",
        `The background subagent "${taskId}" belongs to another root.`,
        { taskId, rootId: view.rootId }
      );
    }
    return view;
  }

  #statusResult(view: SubagentStatusView, text: string): SubagentControlResult {
    return Object.freeze({
      isError: false,
      output: Object.freeze([{ type: "text" as const, text }]),
      details: Object.freeze({
        taskId: view.taskId,
        profileId: view.profileId,
        status: view.status,
        childConversationId: view.childConversationId,
        ...(view.startedAtMs !== undefined ? { startedAtMs: view.startedAtMs } : {}),
        ...(view.endedAtMs !== undefined ? { endedAtMs: view.endedAtMs } : {}),
        ...(view.resultRef !== undefined ? { resultRef: view.resultRef } : {}),
      }),
    });
  }

  #error(
    code: SubagentControlErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ): SubagentControlResult {
    return Object.freeze({
      isError: true,
      output: Object.freeze([{ type: "text" as const, text: message }]),
      details: Object.freeze({ errorCode: code, ...details }),
    });
  }
}
