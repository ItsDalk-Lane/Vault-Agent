import type { AgentQuestionAnswers, AskUserQuestionPrompt } from "@/agentMode/session/types";
import {
  Questions,
  type QuestionDocument,
  type QuestionInput,
  type QuestionStore,
} from "@/agentMode/sdk/pi/features/Questions";
import { QuestionBridge } from "@/agentMode/sdk/pi/features/QuestionBridge";

// The bridge hands the persisted requestId/questions to the existing AskUserQuestionPrompter, so the
// durable ask_user path reuses the plugin's normal question UI instead of a second prompt system:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryQuestionStore implements QuestionStore {
  readonly documents = new Map<string, QuestionDocument>();
  async read(requestId: string): Promise<QuestionDocument | undefined> {
    return this.documents.get(requestId);
  }
  async save(document: QuestionDocument): Promise<void> {
    this.documents.set(document.requestId, document);
  }
}

const questions: QuestionInput[] = [
  {
    question: "Which file should I edit?",
    options: [{ label: "notes/a.md" }, { label: "notes/b.md" }],
    answerKey: "file",
  },
  {
    question: "Add tests?",
    options: [{ label: "Yes" }, { label: "No" }],
    allowOther: true,
    answerKey: "tests",
  },
];

function harness(responder: (prompt: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>) {
  const store = new MemoryQuestionStore();
  const questionsService = new Questions({ store, now: () => 1_000 });
  const prompts: AskUserQuestionPrompt[] = [];
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const bridge = new QuestionBridge({
    questions: questionsService,
    sessionId: "session-1",
    prompter: async (prompt) => {
      prompts.push(prompt);
      resolveStarted();
      return responder(prompt);
    },
  });
  return { bridge, prompts, store, questionsService, started };
}

describe("QuestionBridge", () => {
  describe("ask()", () => {
    it("uses the existing prompter with the persisted request and returns its answers", async () => {
      const harnessed = harness(async () => ({ file: "notes/a.md", tests: "Yes" }));

      const result = await harnessed.bridge.ask({ requestId: "ask-1", questions });

      expect(result).toMatchObject({
        requestId: "ask-1",
        status: "answered",
        answers: { file: "notes/a.md", tests: "Yes" },
      });
      expect(harnessed.prompts).toHaveLength(1);
      expect(harnessed.prompts[0]).toMatchObject({
        sessionId: "session-1",
        requestId: "ask-1",
      });
      expect(harnessed.prompts[0]?.questions.map((question) => question.answerKey)).toEqual([
        "file",
        "tests",
      ]);
      expect(harnessed.store.documents.get("ask-1")).toMatchObject({
        status: "answered",
        answers: { file: "notes/a.md", tests: "Yes" },
      });
    });

    it("does not call the prompter again for a replayed answer", async () => {
      const harnessed = harness(async () => ({ file: "notes/b.md", tests: "No" }));
      await harnessed.bridge.ask({ requestId: "ask-1", questions });

      const replay = await harnessed.bridge.ask({ requestId: "ask-1", questions });

      expect(replay.replayed).toBe(true);
      expect(harnessed.prompts).toHaveLength(1);
    });

    it("cancels through the bridge when the Stop signal aborts", async () => {
      const harnessed = harness(() => new Promise<AgentQuestionAnswers>(() => undefined));
      const controller = new AbortController();

      const running = harnessed.bridge.ask({
        requestId: "ask-1",
        questions,
        signal: controller.signal,
      });
      await harnessed.started;
      controller.abort();
      const result = await running;

      expect(result).toMatchObject({ status: "cancelled", answers: {} });
      expect(harnessed.store.documents.get("ask-1")?.status).toBe("cancelled");
    });
  });
});
