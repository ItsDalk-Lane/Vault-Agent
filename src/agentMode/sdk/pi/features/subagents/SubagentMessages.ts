export type SubagentMessageType = "instruction" | "message" | "report";
export type SubagentMessageAck = "stored" | "accepted" | "answered";

export interface SubagentMessageEnvelope {
  readonly messageId: string;
  readonly parentTaskId: string;
  readonly sender: string;
  readonly recipient: string;
  readonly sequence: number;
  readonly causationId: string;
  readonly type: SubagentMessageType;
  readonly payload: { readonly text: string; readonly answerEntryId?: string };
  readonly ack: SubagentMessageAck;
  readonly submissionId?: string;
  readonly answerEntryId?: string;
}

export interface SubagentMailboxState {
  messages: Record<string, SubagentMessageEnvelope>;
  sequences: Record<string, number>;
  stoppedRuns: Record<string, number>;
  epoch: number;
}

export function appendSubagentMessage(
  state: SubagentMailboxState,
  input: Omit<SubagentMessageEnvelope, "sequence" | "ack" | "submissionId" | "answerEntryId">
): { readonly message: SubagentMessageEnvelope; readonly created: boolean } {
  const prior = state.messages[input.messageId];
  if (prior) {
    if (
      prior.parentTaskId !== input.parentTaskId ||
      prior.sender !== input.sender ||
      prior.recipient !== input.recipient ||
      prior.causationId !== input.causationId ||
      prior.type !== input.type ||
      prior.payload.text !== input.payload.text ||
      prior.payload.answerEntryId !== input.payload.answerEntryId
    )
      throw new Error("同一消息编号不能发送不同内容或改换接收任务。");
    return { message: prior, created: false };
  }
  const sequence = (state.sequences[input.recipient] ?? 0) + 1;
  const message: SubagentMessageEnvelope = { ...input, sequence, ack: "stored" };
  state.sequences[input.recipient] = sequence;
  state.messages[input.messageId] = message;
  return { message, created: true };
}

export function acknowledgeSubagentMessage(
  state: SubagentMailboxState,
  messageId: string,
  acknowledgement: {
    readonly ack: SubagentMessageAck;
    readonly submissionId?: string;
    readonly answerEntryId?: string;
  }
): SubagentMessageEnvelope {
  const message = state.messages[messageId];
  if (!message) throw new Error("不能确认不存在的子任务消息。");
  const order: readonly SubagentMessageAck[] = ["stored", "accepted", "answered"];
  // 回执只确认持久接纳或实际答案，不表示模型理解，更不承诺外部副作用只执行一次。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const ack =
    order.indexOf(acknowledgement.ack) > order.indexOf(message.ack)
      ? acknowledgement.ack
      : message.ack;
  const updated = { ...message, ...acknowledgement, ack };
  state.messages[messageId] = updated;
  return updated;
}

export function canSendSubagentMessage(
  sender: string,
  recipient: string,
  root: string,
  parents: Readonly<Record<string, string>>,
  peerAuthorized = false
): boolean {
  if (
    sender === recipient ||
    (sender !== root && !parents[sender]) ||
    (recipient !== root && !parents[recipient])
  )
    return false;
  const ancestors = (id: string): readonly string[] => {
    const result: string[] = [];
    for (let parent = parents[id]; parent; parent = parents[parent]) result.push(parent);
    return result;
  };
  return (
    ancestors(sender).includes(recipient) ||
    ancestors(recipient).includes(sender) ||
    (peerAuthorized && parents[sender] === parents[recipient])
  );
}
