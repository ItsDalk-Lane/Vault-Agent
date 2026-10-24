import {
  acknowledgeSubagentMessage,
  appendSubagentMessage,
  canSendSubagentMessage,
  type SubagentMailboxState,
} from "@/agentMode/sdk/pi/features/subagents/SubagentMessages";

function mailbox(): SubagentMailboxState {
  return { messages: {}, sequences: {}, stoppedRuns: {}, epoch: 0 };
}

const INPUT = {
  messageId: "root:send-1",
  parentTaskId: "root",
  sender: "root",
  recipient: "child",
  causationId: "call-1",
  type: "message" as const,
  payload: { text: "Read the supplied material." },
};

describe("SubagentMessages", () => {
  describe("appendSubagentMessage()", () => {
    it("stores immutable identity and allocates an increasing sequence for each recipient https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const state = mailbox();
      expect(appendSubagentMessage(state, INPUT)).toMatchObject({
        created: true,
        message: { sequence: 1, ack: "stored" },
      });
      expect(
        appendSubagentMessage(state, { ...INPUT, messageId: "root:send-2" }).message.sequence
      ).toBe(2);
      expect(
        appendSubagentMessage(state, { ...INPUT, messageId: "root:send-3", recipient: "other" })
          .message.sequence
      ).toBe(1);
    });
    it("retains the original acknowledgement on replay after reopening without accepting conflicting content https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const state = mailbox();
      appendSubagentMessage(state, INPUT);
      acknowledgeSubagentMessage(state, INPUT.messageId, {
        ack: "accepted",
        submissionId: "submission-1",
      });
      const restored = JSON.parse(JSON.stringify(state)) as SubagentMailboxState;
      expect(appendSubagentMessage(restored, INPUT)).toMatchObject({
        created: false,
        message: { sequence: 1, ack: "accepted", submissionId: "submission-1" },
      });
      expect(() =>
        appendSubagentMessage(restored, { ...INPUT, payload: { text: "different" } })
      ).toThrow("不同内容");
      expect(restored.sequences.child).toBe(1);
    });
  });
  describe("acknowledgeSubagentMessage()", () => {
    it("keeps acknowledgement progress monotonic and ties an answered message to its real answer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const state = mailbox();
      appendSubagentMessage(state, INPUT);
      acknowledgeSubagentMessage(state, INPUT.messageId, {
        ack: "accepted",
        submissionId: "submission-1",
      });
      acknowledgeSubagentMessage(state, INPUT.messageId, {
        ack: "answered",
        answerEntryId: "answer-1",
      });
      expect(acknowledgeSubagentMessage(state, INPUT.messageId, { ack: "stored" })).toMatchObject({
        ack: "answered",
        answerEntryId: "answer-1",
        submissionId: "submission-1",
      });
      expect(() => acknowledgeSubagentMessage(state, "missing", { ack: "accepted" })).toThrow(
        "不存在"
      );
    });
  });
  describe("canSendSubagentMessage()", () => {
    it("allows parent-child communication while requiring host authorization for sibling messages https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const parents = { child: "root", sibling: "root", grandchild: "child" };
      expect(canSendSubagentMessage("root", "child", "root", parents)).toBe(true);
      expect(canSendSubagentMessage("grandchild", "root", "root", parents)).toBe(true);
      expect(canSendSubagentMessage("child", "sibling", "root", parents)).toBe(false);
      expect(canSendSubagentMessage("child", "sibling", "root", parents, true)).toBe(true);
      expect(canSendSubagentMessage("unknown", "child", "root", parents, true)).toBe(false);
      expect(canSendSubagentMessage("child", "unknown", "root", parents, true)).toBe(false);
      expect(canSendSubagentMessage("child", "child", "root", parents, true)).toBe(false);
    });
  });
});
