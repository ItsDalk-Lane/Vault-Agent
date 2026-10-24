import { withDiagnosticSummaries } from "./diagnosticSummaryProvider";

const push = jest.fn();
const end = jest.fn();
jest.mock(
  "@earendil-works/pi-ai",
  () => ({
    createAssistantMessageEventStream: () => ({ push, end }),
    fauxAssistantMessage: (text: string) => ({
      role: "assistant",
      content: [{ type: "text", text }],
    }),
  }),
  { virtual: true }
);

describe("diagnosticSummaryProvider", () => {
  describe("withDiagnosticSummaries()", () => {
    it("answers actual SDK summary requests without consuming the scripted task response queue https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const stream = jest.fn();
      const streamSimple = jest.fn();
      const onSummary = jest.fn();
      const wrapped = withDiagnosticSummaries({ stream, streamSimple }, onSummary);
      const context = {
        messages: [
          {
            role: "system",
            content: "You are a context summarization assistant. Summarize actual history.",
            timestamp: 1,
          },
        ],
      };
      const model = {} as Parameters<typeof wrapped.stream>[0];
      wrapped.stream(model, context as Parameters<typeof wrapped.stream>[1], {});
      expect(stream).not.toHaveBeenCalled();
      expect(onSummary).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledWith(expect.objectContaining({ role: "assistant" }));
      expect(push).toHaveBeenCalledWith(expect.objectContaining({ type: "done", reason: "stop" }));
      const quote = {
        messages: [
          { role: "user", content: "You are a context summarization assistant.", timestamp: 1 },
        ],
      };
      wrapped.streamSimple(model, quote as Parameters<typeof wrapped.streamSimple>[1], {});
      expect(streamSimple).toHaveBeenCalledTimes(1);
    });
  });
});
