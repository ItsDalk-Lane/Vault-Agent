import type { AgentQuestionAnswers, AskUserQuestionPrompt } from "@/agentMode/session/types";
import {
  MAX_OPTIONS,
  Questions,
  QuestionError,
  type QuestionDocument,
  type QuestionInput,
  type QuestionStore,
  type QuestionDocumentStatus,
} from "@/agentMode/sdk/pi/features/Questions";

// ask_user persists the questions first and the validated answer before resolving. Reopening a
// pending request reuses the same requestId/questions; a delivered answer is replayed, never
// delivered twice; Stop resolves with an explicit cancellation (no default answer) and later
// prompter results cannot overwrite it:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryQuestionStore implements QuestionStore {
  readonly documents = new Map<string, QuestionDocument>();
  saveCount = 0;

  async read(requestId: string): Promise<QuestionDocument | undefined> {
    return this.documents.get(requestId);
  }

  async save(document: QuestionDocument, expectedStatus?: QuestionDocumentStatus): Promise<void> {
    if (
      expectedStatus !== undefined &&
      this.documents.get(document.requestId)?.status !== expectedStatus
    )
      throw new QuestionError("QUESTION_NOT_PENDING", "This question is no longer pending.");
    this.saveCount += 1;
    this.documents.set(document.requestId, document);
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function multiSelectQuestions(): QuestionInput[] {
  return [
    {
      question: "Which files?",
      header: "Files",
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
      multiSelect: true,
      answerKey: "files",
    },
    {
      question: "Anything else?",
      options: [{ label: "Yes" }, { label: "No" }],
      allowOther: true,
      answerKey: "other",
    },
  ];
}

interface Harness {
  readonly questions: Questions;
  readonly store: MemoryQuestionStore;
  readonly promptStarted: Promise<void>;
  prompts: AskUserQuestionPrompt[];
  responder: (prompt: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;
  promptStartedResolve: () => void;
}

function harness(now = 1_000): Harness {
  const store = new MemoryQuestionStore();
  const prompts: AskUserQuestionPrompt[] = [];
  const started = deferred<void>();
  const state: Harness = {
    questions: new Questions({ store, now: () => now }),
    store,
    promptStarted: started.promise,
    prompts,
    responder: async () => ({}),
    promptStartedResolve: () => started.resolve(),
  };
  return state;
}

function promptPort(state: Harness) {
  return async (prompt: AskUserQuestionPrompt): Promise<AgentQuestionAnswers> => {
    state.prompts.push(prompt);
    state.promptStartedResolve();
    return state.responder(prompt);
  };
}

describe("Questions", () => {
  describe("suspend()", () => {
    it("withdraws the live window without cancelling the durable question and exits only when the SDK context closes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      const controller = new AbortController();
      const withdrawn = deferred<void>();
      state.responder = (prompt) =>
        new Promise((resolve) => {
          prompt.signal?.addEventListener(
            "abort",
            () => {
              withdrawn.resolve();
              resolve({});
            },
            { once: true }
          );
        });
      const running = state.questions.ask(
        {
          requestId: "ask-1",
          sessionId: "session-1",
          questions: multiSelectQuestions(),
          signal: controller.signal,
        },
        promptPort(state)
      );
      await state.promptStarted;
      state.questions.suspend();
      state.questions.suspend();
      await withdrawn.promise;
      expect(state.questions.pendingCount).toBe(1);
      expect(controller.signal.aborted).toBe(false);
      expect(state.store.documents.get("ask-1")).toMatchObject({
        status: "pending",
        answers: null,
      });
      controller.abort(new Error("SDK closed"));
      await expect(running).rejects.toThrow("SDK closed");
      await state.questions.waitForRequestSettled("ask-1");
      expect(state.questions.pendingCount).toBe(0);
      expect(state.store.saveCount).toBe(1);
      expect(state.store.documents.get("ask-1")).toMatchObject({
        status: "pending",
        answers: null,
      });
      const reopened = new Questions({ store: state.store });
      const prompt = jest.fn(async (_request: AskUserQuestionPrompt) => ({ files: "A" }));
      expect(prompt).not.toHaveBeenCalled();
      expect(
        await reopened.ask(
          { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
          prompt
        )
      ).toMatchObject({ status: "answered", answers: { files: "A" } });
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(prompt.mock.calls[0][0]).toMatchObject({ requestId: "ask-1" });
    });
  });

  describe("cancelPending()", () => {
    const document = (): QuestionDocument => ({
      requestId: "restored-question",
      sessionId: "session-1",
      questions: [],
      status: "pending",
      answers: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    it("cancels a restored unanswered document without inventing an answer and tolerates repeated Stop https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      const saved = document();
      state.store.documents.set(saved.requestId, saved);
      const service = state.questions;
      await service.cancelPending(saved);
      await service.cancelPending(saved);
      await service.cancelPending({ requestId: "unknown", sessionId: "session-1" });
      expect(state.store.documents.get(saved.requestId)).toEqual({
        ...saved,
        status: "cancelled",
        answers: null,
        updatedAtMs: 1_000,
      });
      expect(state.store.saveCount).toBe(1);
      expect(state.prompts).toEqual([]);
      expect(state.questions.pendingCount).toBe(0);
    });

    it("leaves a concurrent saved answer intact when the cancellation transaction loses the race https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      const saved = document();
      state.store.documents.set(saved.requestId, saved);
      const answered: QuestionDocument = { ...saved, status: "answered", answers: { check: "A" } };
      jest.spyOn(state.store, "save").mockImplementationOnce(async () => {
        state.store.documents.set(saved.requestId, answered);
        throw new QuestionError("QUESTION_NOT_PENDING", "The answer was already saved.");
      });
      await expect(state.questions.cancelPending(saved)).resolves.toBeUndefined();
      expect(state.store.documents.get(saved.requestId)).toEqual(answered);
    });

    it("reports a real cancellation write failure and keeps the pending document readable https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      const saved = document();
      state.store.documents.set(saved.requestId, saved);
      jest.spyOn(state.store, "save").mockRejectedValueOnce(new Error("disk failed"));
      await expect(state.questions.cancelPending(saved)).rejects.toMatchObject({
        code: "QUESTION_STORE_FAILED",
        message: "disk failed",
      });
      expect(state.store.documents.get(saved.requestId)).toEqual(saved);
    });
  });

  describe("answerPending()", () => {
    const saved = (): QuestionDocument => ({
      requestId: "restored-question",
      sessionId: "session-1",
      questions: [
        {
          question: "Which files?",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: true,
          allowOther: false,
          answerKey: "files",
        },
      ],
      status: "pending",
      answers: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    const answer = (
      state: Harness,
      input: { requestId: string; sessionId: string; answers: AgentQuestionAnswers }
    ) => state.questions.answerPending(input);

    it("saves an explicit restored answer with its original identity without asking or starting work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      state.store.documents.set("restored-question", saved());

      await answer(state, {
        requestId: "restored-question",
        sessionId: "session-1",
        answers: { files: "A, B, A" },
      });

      expect(state.store.documents.get("restored-question")).toMatchObject({
        requestId: "restored-question",
        sessionId: "session-1",
        status: "answered",
        answers: { files: "A, B" },
        createdAtMs: 1,
        updatedAtMs: 1_000,
      });
      expect(state.store.saveCount).toBe(1);
      expect(state.questions.pendingCount).toBe(0);
      expect(state.prompts).toEqual([]);
    });

    it("refuses unknown, unrelated, cancelled and already answered requests without changing them https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      for (const document of [
        undefined,
        { ...saved(), sessionId: "another-session" },
        { ...saved(), status: "answered" as const, answers: { files: "A" } },
        { ...saved(), status: "cancelled" as const },
      ]) {
        const state = harness();
        if (document) state.store.documents.set("restored-question", document);
        await expect(
          answer(state, {
            requestId: "restored-question",
            sessionId: "session-1",
            answers: { files: "B" },
          })
        ).rejects.toMatchObject({ code: "QUESTION_NOT_PENDING" });
        expect(state.store.documents.get("restored-question")).toEqual(document);
        expect(state.store.saveCount).toBe(0);
      }
    });

    it("rejects empty and invalid answers while retaining the pending request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      state.store.documents.set("restored-question", saved());
      const invalidAnswers: AgentQuestionAnswers[] = [
        {},
        { files: " " },
        { files: "not an option" },
      ];
      for (const answers of invalidAnswers)
        await expect(
          answer(state, { requestId: "restored-question", sessionId: "session-1", answers })
        ).rejects.toMatchObject({ code: "QUESTION_INVALID_ANSWER" });
      expect(state.store.documents.get("restored-question")).toEqual(saved());
      expect(state.store.saveCount).toBe(0);
    });

    it("reports a failed answer write instead of pretending it was saved https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      state.store.documents.set("restored-question", saved());
      jest.spyOn(state.store, "save").mockRejectedValueOnce(new Error("disk failed"));
      await expect(
        answer(state, {
          requestId: "restored-question",
          sessionId: "session-1",
          answers: { files: "A" },
        })
      ).rejects.toMatchObject({ code: "QUESTION_STORE_FAILED", message: "disk failed" });
      expect(state.store.documents.get("restored-question")).toEqual(saved());
    });
  });

  describe("ask()", () => {
    it.each(["answer", "cancel"] as const)(
      "uses the committed first answer when another window wins the pending transaction during %s https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (action) => {
        const state = harness();
        const controller = new AbortController();
        const live = deferred<AgentQuestionAnswers>();
        state.responder = () =>
          action === "answer" ? Promise.resolve({ files: "B" }) : live.promise;
        const save = state.store.save.bind(state.store);
        jest.spyOn(state.store, "save").mockImplementation(async (document, expected) => {
          if (
            (action === "answer" && document.status === "answered") ||
            (action === "cancel" && document.status === "cancelled")
          ) {
            await save({ ...document, status: "answered", answers: { files: "A" } }, expected);
            throw new QuestionError("QUESTION_NOT_PENDING", "another window saved first");
          }
          await save(document, expected);
        });
        const running = state.questions.ask(
          {
            requestId: "ask-1",
            sessionId: "session-1",
            questions: multiSelectQuestions(),
            signal: controller.signal,
          },
          promptPort(state)
        );
        await state.promptStarted;
        if (action === "cancel") controller.abort();
        expect(await running).toMatchObject({ status: "answered", answers: { files: "A" } });
        live.resolve({ files: "B" });
        await state.questions.waitForRequestSettled("ask-1");
        expect(state.store.documents.get("ask-1")).toMatchObject({
          status: "answered",
          answers: { files: "A" },
        });
      }
    );

    it.each([false, true])(
      "returns the committed answer when it arrives before the live prompt, even if Stop follows (%s) https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (stop) => {
        const state = harness();
        const controller = new AbortController();
        const save = state.store.save.bind(state.store);
        jest.spyOn(state.store, "save").mockImplementation(async (document, expected) => {
          await save(document, expected);
          if (document.status === "pending") {
            await state.questions.answerPending({
              requestId: document.requestId,
              sessionId: document.sessionId,
              answers: { files: "A" },
            });
            if (stop) controller.abort();
          }
        });
        const prompt = jest.fn(async () => ({ files: "B" }));
        expect(
          await state.questions.ask(
            {
              requestId: "ask-1",
              sessionId: "session-1",
              questions: multiSelectQuestions(),
              signal: controller.signal,
            },
            prompt
          )
        ).toMatchObject({ status: "answered", answers: { files: "A" } });
        expect(prompt).not.toHaveBeenCalled();
        expect(state.store.documents.get("ask-1")).toMatchObject({
          status: "answered",
          answers: { files: "A" },
        });
      }
    );

    it("settles an active ask from the first durable window answer and ignores a late live answer or Stop https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      const liveAnswer = deferred<AgentQuestionAnswers>();
      state.responder = () => liveAnswer.promise;
      const controller = new AbortController();
      const running = state.questions.ask(
        {
          requestId: "ask-1",
          sessionId: "session-1",
          questions: multiSelectQuestions(),
          signal: controller.signal,
        },
        promptPort(state)
      );
      await state.promptStarted;
      const answers = await Promise.allSettled([
        state.questions.answerPending({
          requestId: "ask-1",
          sessionId: "session-1",
          answers: { files: "A" },
        }),
        state.questions.answerPending({
          requestId: "ask-1",
          sessionId: "session-1",
          answers: { files: "B" },
        }),
      ]);
      expect(answers.map((answer) => answer.status)).toEqual(["fulfilled", "rejected"]);
      expect(await running).toMatchObject({ status: "answered", answers: { files: "A" } });
      expect(state.prompts[0].signal?.aborted).toBe(true);
      expect(controller.signal.aborted).toBe(false);
      liveAnswer.resolve({ files: "B" });
      controller.abort();
      await state.questions.waitForRequestSettled("ask-1");
      expect(state.store.documents.get("ask-1")).toMatchObject({
        status: "answered",
        answers: { files: "A" },
      });
      const reopened = new Questions({ store: state.store });
      const prompt = jest.fn();
      expect(
        await reopened.ask(
          { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
          prompt
        )
      ).toMatchObject({ status: "answered", replayed: true, answers: { files: "A" } });
      expect(prompt).not.toHaveBeenCalled();
    });

    it("settles an active ask when the durable request is cancelled and does not resurrect it on reopen https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      const liveAnswer = deferred<AgentQuestionAnswers>();
      state.responder = () => liveAnswer.promise;
      const running = state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );
      await state.promptStarted;
      await state.questions.cancelPending({ requestId: "ask-1", sessionId: "session-1" });
      expect(await running).toMatchObject({ status: "cancelled", answers: {} });
      expect(state.prompts[0].signal?.aborted).toBe(true);
      liveAnswer.resolve({ files: "B" });
      await state.questions.waitForRequestSettled("ask-1");
      const reopened = new Questions({ store: state.store });
      const prompt = jest.fn();
      expect(
        await reopened.ask(
          { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
          prompt
        )
      ).toMatchObject({ status: "cancelled", replayed: true, answers: {} });
      expect(prompt).not.toHaveBeenCalled();
    });

    it("reports a failed live answer save instead of leaving the active ask unresolved https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const state = harness();
      const save = state.store.save.bind(state.store);
      jest.spyOn(state.store, "save").mockImplementation((document, expected) => {
        if (document.status === "answered") return Promise.reject(new Error("answer disk failed"));
        return save(document, expected);
      });
      await expect(
        state.questions.ask(
          { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
          async () => ({ files: "A" })
        )
      ).rejects.toMatchObject({ code: "QUESTION_STORE_FAILED", message: "answer disk failed" });
      expect(state.store.documents.get("ask-1")).toMatchObject({
        status: "pending",
        answers: null,
      });
      expect(state.questions.pendingCount).toBe(0);
    });

    it("delivers multi-select and other text answers", async () => {
      const state = harness();
      state.responder = async () => ({ files: "A, B", other: "my own answer" });

      const result = await state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );

      expect(result).toMatchObject({
        requestId: "ask-1",
        status: "answered",
        replayed: false,
        answers: { files: "A, B", other: "my own answer" },
      });
      expect(state.prompts[0]).toMatchObject({
        sessionId: "session-1",
        requestId: "ask-1",
        questions: [
          { question: "Which files?", multiSelect: true, answerKey: "files" },
          { question: "Anything else?", allowOther: true, answerKey: "other" },
        ],
      });
      expect(state.store.documents.get("ask-1")).toMatchObject({
        status: "answered",
        answers: { files: "A, B", other: "my own answer" },
      });
    });

    it("persists the pending document before prompting", async () => {
      const state = harness();
      let statusBeforePrompt = "";
      state.responder = async () => {
        statusBeforePrompt = state.store.documents.get("ask-1")?.status ?? "";
        return { files: "A", other: "ok" };
      };

      await state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );

      expect(statusBeforePrompt).toBe("pending");
    });

    it("replays a delivered answer without prompting or delivering twice", async () => {
      const state = harness();
      state.responder = async () => ({ files: "A", other: "ok" });
      await state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );

      const replay = await state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );

      expect(replay).toMatchObject({
        status: "answered",
        replayed: true,
        answers: { files: "A", other: "ok" },
      });
      expect(state.prompts).toHaveLength(1);
    });

    it("reopens a pending request with the same requestId instead of generating a new one", async () => {
      const store = new MemoryQuestionStore();
      await store.save({
        requestId: "ask-1",
        sessionId: "session-1",
        questions: [
          {
            question: "Which files?",
            options: [{ label: "A" }, { label: "B" }],
            multiSelect: true,
            allowOther: false,
            answerKey: "files",
          },
        ],
        status: "pending",
        answers: null,
        createdAtMs: 1_000,
        updatedAtMs: 1_000,
      });
      const restarted = new Questions({ store, now: () => 2_000 });
      const prompts: AskUserQuestionPrompt[] = [];

      const result = await restarted.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        async (prompt) => {
          prompts.push(prompt);
          return { files: "B" };
        }
      );

      expect(prompts).toHaveLength(1);
      expect(prompts[0]?.requestId).toBe("ask-1");
      expect(prompts[0]?.questions).toHaveLength(1);
      expect(result.status).toBe("answered");
      expect(result.answers).toEqual({ files: "B" });
      expect(store.documents.get("ask-1")?.createdAtMs).toBe(1_000);
    });

    it("returns the same in-flight request to a concurrent reopen without a second prompt", async () => {
      const state = harness();
      const answer = deferred<AgentQuestionAnswers>();
      state.responder = () => answer.promise;

      const first = state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );
      const second = state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );
      answer.resolve({ files: "C", other: "ok" });
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(state.prompts).toHaveLength(1);
      expect(firstResult).toEqual(secondResult);
    });

    it("does not deliver an invalid answer", async () => {
      const state = harness();
      state.responder = async () => ({ files: "Not An Option", other: "" });

      const result = await state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );

      expect(result).toMatchObject({ status: "cancelled", answers: {} });
      expect(state.store.documents.get("ask-1")?.status).toBe("cancelled");
    });

    it("does not treat an empty answer as agreement", async () => {
      const state = harness();
      state.responder = async () => ({});

      const result = await state.questions.ask(
        { requestId: "ask-1", sessionId: "session-1", questions: multiSelectQuestions() },
        promptPort(state)
      );

      expect(result.status).toBe("answered");
      expect(result.answers).toEqual({});
    });

    it("resolves a Stop with cancellation, no default answers and no dangling waiter", async () => {
      const state = harness();
      const pending = deferred<AgentQuestionAnswers>();
      state.responder = () => pending.promise;
      const controller = new AbortController();

      const running = state.questions.ask(
        {
          requestId: "ask-1",
          sessionId: "session-1",
          questions: multiSelectQuestions(),
          signal: controller.signal,
        },
        promptPort(state)
      );
      await state.promptStarted;
      controller.abort();
      const result = await running;

      expect(result).toMatchObject({ status: "cancelled", answers: {} });
      expect(state.questions.pendingCount).toBe(0);
      expect(state.store.documents.get("ask-1")?.status).toBe("cancelled");

      pending.resolve({ files: "A", other: "late" });
      await state.questions.waitForRequestSettled("ask-1");
      expect(state.store.documents.get("ask-1")?.status).toBe("cancelled");
      expect(state.store.documents.get("ask-1")?.answers).toBeNull();
    });

    it("validates question count, option count and answerKey uniqueness", async () => {
      const state = harness();
      const port = promptPort(state);

      await expect(
        state.questions.ask({ requestId: "ask-1", sessionId: "session-1", questions: [] }, port)
      ).rejects.toBeInstanceOf(QuestionError);
      await expect(
        state.questions.ask(
          {
            requestId: "ask-2",
            sessionId: "session-1",
            questions: Array.from({ length: 7 }, (_, index) => ({
              question: `q${index}`,
              options: [{ label: "A" }],
              answerKey: `key${index}`,
            })),
          },
          port
        )
      ).rejects.toMatchObject({ code: "QUESTION_INVALID_ARGUMENT" });
      await expect(
        state.questions.ask(
          {
            requestId: "ask-3",
            sessionId: "session-1",
            questions: [
              {
                question: "many",
                options: Array.from({ length: MAX_OPTIONS + 1 }, (_, index) => ({
                  label: `option-${index}`,
                })),
              },
            ],
          },
          port
        )
      ).rejects.toMatchObject({ code: "QUESTION_INVALID_ARGUMENT" });
      await expect(
        state.questions.ask(
          {
            requestId: "ask-4",
            sessionId: "session-1",
            questions: [
              { question: "one", options: [{ label: "A" }], answerKey: "same" },
              { question: "two", options: [{ label: "B" }], answerKey: "same" },
            ],
          },
          port
        )
      ).rejects.toMatchObject({ code: "QUESTION_INVALID_ARGUMENT" });
      expect(state.prompts).toEqual([]);
    });
  });
});
