import { sha256 } from "@/utils/hash";
import { byteLength, headOfText } from "@/utils/logTail";
import { PROMPT_CONTEXT_MAX_BYTES } from "@/agentMode/session/types";
import { v4 as uuidv4 } from "uuid";
import { resolveAnswererModels, type FanoutModelOption } from "./answerers";
import type {
  BackendDescriptor,
  BackendId,
  BackendProcess,
  ModelSelection,
  PromptContent,
  PromptContext,
  PromptInput,
  SessionId,
} from "@/agentMode/session/types";
import {
  buildSummaryUserPrompt,
  fanoutAllFailedSummary,
  selectSummaryInputs,
  type AgentAnswer,
  type FanoutTurn,
} from "./fanoutTypes";

export interface FanoutHost {
  ensureBackendForFanout(
    backendId: BackendId
  ): Promise<{ proc: BackendProcess; descriptor: BackendDescriptor }>;
  getDefaultSelection(backendId: BackendId): ModelSelection | null;
  getFanoutModels(): readonly FanoutModelOption[];
  getDisplayName(modelKey: string): string;
  getCwd(): string | null;
  registerReadOnlySession(sessionId: SessionId): () => void;
  excludeSubSessionFromHistory(backendId: BackendId, sessionId: SessionId): void;
}

export interface FanoutRunInput {
  agents: ReadonlyArray<string>;
  fanoutId?: string;
  mainModelKey?: string;
  projectId?: string;
  parentSessionId?: SessionId;
  resumeTurn?: FanoutTurn;
  mainAgent: BackendId;
  prompt: PromptContent[];
  context?: PromptInput["context"];
  originalPromptText: string;
  signal: AbortSignal;
  onChange: (turn: FanoutTurn) => void;
}

export function createFanoutTurn(modelKeys: ReadonlyArray<string>): FanoutTurn {
  const answers: Record<string, AgentAnswer> = {};
  for (const modelKey of modelKeys)
    answers[modelKey] = { backendId: "pi", modelKey, status: "running", text: "" };
  return { answers, summary: { status: "pending", text: "" } };
}

function checkpointContext(context: PromptContext): PromptContext {
  const materials: PromptContext["materials"][number][] = [];
  let project: PromptContext["project"];
  let bytes = byteLength(JSON.stringify({ materials }));
  let unrecorded = 0;
  const limit = PROMPT_CONTEXT_MAX_BYTES - 256;
  const append = (material: PromptContext["materials"][number]) => {
    const size = byteLength(JSON.stringify(material)) + (materials.length > 0 ? 1 : 0);
    if (bytes + size > limit) return false;
    materials.push(material);
    bytes += size;
    return true;
  };
  const omitted = (
    text: string,
    source: string,
    origin: PromptContext["materials"][number]["origin"]
  ) => {
    const name = headOfText(source, 512);
    const receipt = {
      origin,
      text: `[恢复材料已省略：原文超过恢复快照的${PROMPT_CONTEXT_MAX_BYTES}字节上限；原文${byteLength(text)}字节；SHA256 ${sha256(text)}；来源${name.text}${name.totalBytes > 512 ? "（来源已截短）" : ""}。请按需重新读取原文。]`,
      explicitlyImported: true,
    };
    if (!append(receipt)) unrecorded += 1;
  };
  if (context.project) {
    const withProject = byteLength(JSON.stringify({ project: context.project, materials }));
    if (withProject <= limit) {
      project = context.project;
      bytes = withProject;
    } else {
      omitted(context.project.text, context.project.sourcePath ?? "项目资料", "note");
    }
  }
  // 恢复快照限制体积且只保存整份材料；实时回答仍使用原资料，不能把截断正文伪装成完整来源。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  for (const material of context.materials) {
    if (!append(material))
      omitted(
        material.text,
        material.sourcePath ?? material.url ?? material.origin,
        material.origin
      );
  }
  if (unrecorded > 0) {
    materials.push({
      origin: "note",
      text: `[另有${unrecorded}项恢复材料及其来源说明因快照体积上限已省略，请按需重新选择。]`,
    });
  }
  return { ...(project ? { project } : {}), materials };
}

export class FanoutOrchestrator {
  constructor(private readonly host: FanoutHost) {}

  async run(input: FanoutRunInput): Promise<FanoutTurn> {
    return this.runModels(input);
  }

  private async runModels(input: FanoutRunInput): Promise<FanoutTurn> {
    const availableModels = this.host.getFanoutModels();
    const selected = resolveAnswererModels({ mentionedModelKeys: input.agents, availableModels });
    const mainModelKey =
      input.mainModelKey ?? this.host.getDefaultSelection("pi")?.baseModelId ?? selected[0];
    const fanoutId = input.fanoutId ?? uuidv4();
    const turn = createFanoutTurn(selected);
    turn.checkpoint = {
      fanoutId,
      mainModelKey,
      prompt: input.prompt,
      ...(input.context ? { context: checkpointContext(input.context) } : {}),
      originalPromptText: input.originalPromptText,
    };
    // 重开只恢复尚未完成的回答器，保留已收费的结果。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    for (const modelKey of selected) {
      const previous = input.resumeTurn?.answers[modelKey];
      const option = availableModels.find((model) => model.modelKey === modelKey);
      turn.answers[modelKey] =
        previous?.status === "done" || previous?.status === "error"
          ? { ...previous }
          : {
              backendId: "pi",
              modelKey,
              label: option?.label ?? this.host.getDisplayName(modelKey),
              status: "running",
              text: "",
            };
    }
    if (input.resumeTurn?.summary.complete) turn.summary = { ...input.resumeTurn.summary };
    input.onChange(turn);
    const proc = input.parentSessionId
      ? (await this.host.ensureBackendForFanout("pi")).proc
      : undefined;
    let saved = Promise.resolve();
    const persist = () => {
      const snapshot = JSON.parse(JSON.stringify(turn)) as FanoutTurn;
      saved = saved.then(() =>
        input.parentSessionId
          ? proc?.recordFanoutTurn?.({ sessionId: input.parentSessionId, turn: snapshot })
          : undefined
      );
      return saved;
    };
    try {
      await persist();
    } catch (error: unknown) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      // 尚未得到执行名额的比较只保存原问题，关闭后不能误报额度耗尽或创建候选请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (code === "QUEUED_INPUT_PAUSED") {
        turn.checkpoint.awaitingAdmission = true;
        for (const answer of Object.values(turn.answers))
          if (answer.status === "running") answer.status = "paused";
        turn.summary = { status: "paused", text: "", complete: false };
        input.onChange(turn);
        return turn;
      }
      if (input.signal.aborted || code === "CANCELLED") {
        for (const answer of Object.values(turn.answers))
          if (answer.status === "running") answer.status = "cancelled";
        turn.summary = { status: "done", text: "", complete: false };
        input.onChange(turn);
        return turn;
      }
      throw error;
    }
    await Promise.all(
      selected.map(async (modelKey) => {
        const slot = turn.answers[modelKey];
        if (slot.status !== "running") return;
        try {
          const outcome = await this.runModelSession(
            input,
            fanoutId,
            modelKey,
            modelKey,
            input.prompt,
            (text) => {
              slot.text = text;
              input.onChange(turn);
            },
            input.context
          );
          slot.completion = outcome.completion;
          slot.status =
            outcome.status === "paused"
              ? "paused"
              : outcome.status === "cancelled"
                ? "cancelled"
                : slot.text.trim()
                  ? "done"
                  : "error";
          if (slot.status === "error") slot.error = "The model finished without an answer.";
        } catch (error) {
          slot.status = input.signal.aborted ? "cancelled" : "error";
          slot.error = error instanceof Error ? error.message : String(error);
        }
        input.onChange(turn);
        await persist();
      })
    );
    // 预算暂停保留同一 SDK 请求和候选结果，不能汇总半途输出或在 finally 中销毁恢复点。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (Object.values(turn.answers).some((answer) => answer.status === "paused")) {
      turn.summary = { status: "paused", text: turn.summary.text, complete: false };
      input.onChange(turn);
      await persist();
      return turn;
    }
    if (input.signal.aborted || turn.summary.complete) return turn;
    const summaryPrompt = buildSummaryUserPrompt(
      input.originalPromptText,
      selectSummaryInputs(turn),
      (key) => turn.answers[key]?.label ?? key,
      input.context?.project
    );
    if (!summaryPrompt) {
      turn.summary = { status: "done", text: fanoutAllFailedSummary(), complete: true };
      input.onChange(turn);
      await persist();
      return turn;
    }
    turn.summary = { status: "streaming", text: "" };
    input.onChange(turn);
    await persist();
    try {
      const outcome = await this.runModelSession(
        input,
        fanoutId,
        "summary",
        mainModelKey,
        summaryPrompt.prompt,
        (text) => {
          turn.summary.text = text;
          input.onChange(turn);
        },
        summaryPrompt.context
      );
      turn.summary.complete = outcome.status === "done" && turn.summary.text.trim().length > 0;
      if (outcome.status === "paused") turn.summary.status = "paused";
    } catch (error) {
      turn.summary.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (turn.summary.status !== "paused") turn.summary.status = "done";
      input.onChange(turn);
      await persist();
    }
    return turn;
  }

  private async runModelSession(
    input: FanoutRunInput,
    fanoutId: string,
    slotId: string,
    modelKey: string,
    prompt: PromptContent[],
    onText: (text: string) => void,
    context?: PromptContext
  ): Promise<{ status: "done" | "cancelled" | "paused"; completion?: AgentAnswer["completion"] }> {
    if (input.signal.aborted) return { status: "cancelled" };
    const { proc } = await this.host.ensureBackendForFanout("pi");
    const sessionId = `root-fanout-${sha256(JSON.stringify([fanoutId, slotId]))}`;
    let detach: (() => void) | undefined;
    let releaseReadOnly: (() => void) | undefined;
    let cancellation: Promise<void> | undefined;
    let paused = false;
    let text = "";
    const cancel = () => {
      cancellation ??= proc.cancel({ sessionId });
    };
    try {
      await proc.newSession({
        sessionId,
        cwd: this.host.getCwd() ?? "",
        parentSessionId: input.parentSessionId,
        parentRunId: fanoutId,
        readOnly: true,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      });
      releaseReadOnly = this.host.registerReadOnlySession(sessionId);
      this.host.excludeSubSessionFromHistory("pi", sessionId);
      detach = proc.registerSessionHandler(sessionId, (event) => {
        const update = event.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          text += update.content.text;
          onText(text);
        } else if (update.sessionUpdate === "session_projection") {
          text = update.projection.messages
            .filter((message) => message.sender !== "user")
            .map((message) => message.message)
            .join("\n\n");
          onText(text);
        }
      });
      // 只读必须在发送前成立，取消或关闭完成前也不能撤销。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      await proc.setSessionMode({ sessionId, modeId: "plan" });
      await proc.setSessionModel({ sessionId, modelId: modelKey });
      input.signal.addEventListener("abort", cancel, { once: true });
      if (input.signal.aborted) return { status: "cancelled" };
      // 候选与汇总沿同一任务树的停止和预算控制，不能因等待较久另行取消仍在工作的模型。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const outcome = await proc.prompt({
        sessionId,
        prompt,
        requestId: `fanout:${fanoutId}:${slotId}`,
        ...(context ? { context } : {}),
      });
      paused = outcome.stopReason === "max_turn_requests";
      return {
        status:
          input.signal.aborted || outcome.stopReason === "cancelled"
            ? "cancelled"
            : paused
              ? "paused"
              : "done",
        completion: {
          sessionId,
          requestId: `fanout:${fanoutId}:${slotId}`,
          stopReason: outcome.stopReason,
        },
      };
    } finally {
      input.signal.removeEventListener("abort", cancel);
      try {
        await cancellation;
        if (!paused) await proc.closeSession?.({ sessionId });
      } finally {
        detach?.();
        releaseReadOnly?.();
      }
    }
  }
}
