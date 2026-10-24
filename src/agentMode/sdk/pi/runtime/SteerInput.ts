import type { Context } from "@earendil-works/chord";
import type {
  Conversation,
  Harness,
  InputEntry,
  LiveState,
  SubmissionRecord,
  UserInput,
} from "@earendil-works/pi-durable";

export interface SteerAdmission {
  readonly harness: Harness;
  readonly conversation: Conversation;
  readonly requestId: string;
  readonly content: UserInput;
  readonly entry: InputEntry;
  readonly context: Context;
  readonly rejectNewRun: (sourceEntryId?: string) => void | Promise<void>;
  readonly release: () => void;
  readonly accepted: (sourceEntryId: string) => Promise<void>;
}

export function assertSteerText(text: string): void {
  if (!text.trim() || /^\s*\//.test(text))
    throw new Error("补充当前工作仅支持普通文字；命令请等本轮结束后发送。");
}

// steer 在空闲时会启动新轮，必须用原输入的真实身份核对已放置结果再放行请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function submitSteerInput(input: SteerAdmission): Promise<void> {
  const { harness, conversation, context } = input;
  const { LiveDoc } = await import("@earendil-works/pi-durable");
  const initial = await harness.snapshot(LiveDoc, conversation.id, context);
  const anchor = initial?.run?.inputs[0];
  if (anchor === undefined) throw new Error("未补充：当前工作已结束，请重新发送。");
  let live: Readonly<LiveState> | undefined = initial;
  let record: SubmissionRecord | undefined;
  let resolvePlacement!: () => void;
  const placed = new Promise<void>((resolve) => (resolvePlacement = resolve));
  const stop = harness.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (
        change.type === "document" &&
        change.record.kind === "pi.live" &&
        change.record.scope.kind === "conversation" &&
        change.record.scope.conversationId === conversation.id
      )
        live = change.value as Readonly<LiveState> | undefined;
      if (
        change.type === "submission" &&
        change.value.conversationId === conversation.id &&
        change.value.requestId === input.requestId
      )
        record = change.value;
    }
    if (record && record.status !== "queued") resolvePlacement();
  });
  const stopClose = harness.subscribeClose(resolvePlacement);
  try {
    const submission = await conversation.submit(
      {
        type: "input",
        requestId: input.requestId,
        content: input.content,
        whenBusy: "steer",
        entry: {
          ...input.entry,
          data: { ...(input.entry.data as object), steerAnchor: Number(anchor) },
        },
      },
      context
    );
    record ??= await submission.status(context);
    if (record.status === "queued") await placed;
    if (
      record.status === "placed" &&
      live?.run?.inputs.includes(anchor) &&
      live.run.inputs.includes(submission.id) &&
      record.entry !== undefined
    ) {
      await input.accepted(String(record.entry));
      return;
    }
    const current = await submission.status(context);
    await input.rejectNewRun(current.entry === undefined ? undefined : String(current.entry));
    input.release();
    if (current.status === "queued") await submission.abort(context);
    else if (live?.run && !live.run.inputs.includes(anchor))
      await harness.abortTask(live.run.taskId, context);
    throw new Error("未补充：当前工作已结束，请重新发送。");
  } finally {
    stop();
    stopClose();
  }
}
