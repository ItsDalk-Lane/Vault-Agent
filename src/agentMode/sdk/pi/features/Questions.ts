import type {
  AgentQuestion,
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  SessionId,
} from "@/agentMode/session/types";

// ask_user persists the exact questions before showing the existing prompter and persists the
// validated user answer before resolving the tool. Reopening the same request uses the stored
// requestId/questions/answers instead of generating a second request; repeated answers are
// delivered once; Stop resolves every waiter with an explicit cancellation and never invents a
// default answer:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface QuestionOptionInput {
  readonly label: string;
  readonly description?: string;
}

export interface QuestionInput {
  readonly question: string;
  readonly header?: string;
  readonly options: readonly QuestionOptionInput[];
  readonly multiSelect?: boolean;
  readonly allowOther?: boolean;
  readonly answerKey?: string;
}

export interface NormalizedQuestion {
  readonly question: string;
  readonly header?: string;
  readonly options: readonly QuestionOptionInput[];
  readonly multiSelect: boolean;
  readonly allowOther: boolean;
  readonly answerKey: string;
}

export type QuestionDocumentStatus = "pending" | "answered" | "cancelled";

export interface QuestionDocument {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly questions: readonly NormalizedQuestion[];
  readonly status: QuestionDocumentStatus;
  readonly answers: AgentQuestionAnswers | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface QuestionStore {
  read(requestId: string): Promise<QuestionDocument | undefined>;
  save(document: QuestionDocument, expectedStatus?: QuestionDocumentStatus): Promise<void>;
}

export type QuestionsPromptPort = (prompt: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;

export interface AskQuestionsInput {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly questions: readonly QuestionInput[];
  readonly signal?: AbortSignal;
}

export interface AskQuestionsResult {
  readonly requestId: string;
  readonly status: "answered" | "cancelled";
  readonly answers: AgentQuestionAnswers;
  readonly replayed: boolean;
}

export interface AnswerPendingQuestionInput {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly answers: AgentQuestionAnswers;
}

export type QuestionErrorCode =
  | "QUESTION_INVALID_ARGUMENT"
  | "QUESTION_INVALID_ANSWER"
  | "QUESTION_NOT_PENDING"
  | "QUESTION_STORE_FAILED";

export class QuestionError extends Error {
  readonly code: QuestionErrorCode;

  constructor(code: QuestionErrorCode, message: string) {
    super(message);
    this.name = "QuestionError";
    this.code = code;
  }
}

export const MAX_QUESTIONS = 6;
export const MAX_OPTIONS = 12;

const EMPTY_ANSWERS: AgentQuestionAnswers = Object.freeze({});

export class Questions {
  readonly #store: QuestionStore;
  readonly #now: () => number;
  readonly #active = new Map<string, Promise<AskQuestionsResult>>();
  readonly #completions = new Map<string, Promise<void>>();
  readonly #lateChains = new Map<string, Promise<void>>();
  readonly #settlers = new Map<string, (document: QuestionDocument) => void>();
  readonly #livePrompts = new Set<AbortController>();
  #suspended = false;
  #waiting = 0;

  constructor(options: { store: QuestionStore; now?: () => number }) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
  }

  get pendingCount(): number {
    return this.#waiting;
  }

  suspend(): void {
    // 暂停只撤界面，不提交取消或工具终态；等 SDK 关闭上下文后退出，原问题由检查点接续。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    this.#suspended = true;
    for (const controller of this.#livePrompts) controller.abort();
  }

  async waitForRequestSettled(requestId: string): Promise<void> {
    await this.#completions.get(requestId);
    await this.#lateChains.get(requestId);
  }

  async answerPending(input: AnswerPendingQuestionInput): Promise<void> {
    this.#validateIdentity(input);
    const document = await this.#store.read(input.requestId);
    if (!document || document.sessionId !== input.sessionId || document.status !== "pending")
      throw new QuestionError("QUESTION_NOT_PENDING", "This question is no longer pending.");
    const answers = validateAnswers(document.questions, input.answers);
    if (!answers || Object.keys(answers).length === 0)
      throw new QuestionError("QUESTION_INVALID_ANSWER", "An explicit valid answer is required.");
    await this.#save(
      Object.freeze({ ...document, status: "answered", answers, updatedAtMs: this.#now() }),
      "pending"
    );
  }

  async cancelPending(input: Pick<QuestionDocument, "requestId" | "sessionId">): Promise<void> {
    this.#validateIdentity(input);
    const document = await this.#store.read(input.requestId);
    if (!document || document.sessionId !== input.sessionId || document.status !== "pending")
      return;
    try {
      await this.#saveCancelled(document, "pending");
    } catch (error) {
      if (!(error instanceof QuestionError) || error.code !== "QUESTION_NOT_PENDING") throw error;
    }
  }

  async ask(input: AskQuestionsInput, prompt: QuestionsPromptPort): Promise<AskQuestionsResult> {
    this.#validateIdentity(input);
    const active = this.#active.get(input.requestId);
    if (active !== undefined) return active;
    const promise = this.#askInternal(input, prompt).finally(() => {
      if (this.#active.get(input.requestId) === promise) {
        this.#active.delete(input.requestId);
      }
    });
    this.#active.set(input.requestId, promise);
    return promise;
  }

  async #askInternal(
    input: AskQuestionsInput,
    prompt: QuestionsPromptPort
  ): Promise<AskQuestionsResult> {
    const existing = await this.#store.read(input.requestId);
    if (existing !== undefined) {
      if (existing.status === "answered" && existing.answers !== null) {
        return this.#answered(input.requestId, existing.answers, true);
      }
      if (existing.status === "cancelled") {
        return this.#cancelled(input.requestId, true);
      }
      return this.#run(existing, prompt, input.signal);
    }
    const questions = normalizeQuestions(input.questions);
    const document: QuestionDocument = Object.freeze({
      requestId: input.requestId,
      sessionId: input.sessionId,
      questions,
      status: "pending",
      answers: null,
      createdAtMs: this.#now(),
      updatedAtMs: this.#now(),
    });
    await this.#store.save(document);
    return this.#run(document, prompt, input.signal);
  }

  #run(
    document: QuestionDocument,
    prompt: QuestionsPromptPort,
    signal?: AbortSignal
  ): Promise<AskQuestionsResult> {
    return this.#promptAndPersist(document, prompt, signal);
  }

  async #promptAndPersist(
    document: QuestionDocument,
    prompt: QuestionsPromptPort,
    signal?: AbortSignal
  ): Promise<AskQuestionsResult> {
    const livePrompt = new AbortController();
    this.#livePrompts.add(livePrompt);
    const request: AskUserQuestionPrompt = {
      sessionId: document.sessionId,
      requestId: document.requestId,
      questions: document.questions.map(toAgentQuestion),
      signal: livePrompt.signal,
    };
    this.#waiting += 1;
    const completion = deferred<void>();
    this.#completions.set(document.requestId, completion.promise);
    const outcome = deferred<QuestionDocument>();
    let terminal: QuestionDocument | undefined;
    let closed = false;
    const accept = (current: QuestionDocument): void => {
      if (
        closed ||
        this.#suspended ||
        terminal ||
        current.status === "pending" ||
        current.requestId !== document.requestId ||
        current.sessionId !== document.sessionId
      )
        return;
      terminal = current;
      outcome.resolve(current);
    };
    const persistTerminal = async (next: QuestionDocument): Promise<void> => {
      if (closed || terminal || this.#suspended) return;
      try {
        // 多窗口和临时回调只能竞争 pending；已保存的答案或取消不能被晚到回调覆盖。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        await this.#save(next, "pending");
      } catch (error) {
        if (!(error instanceof QuestionError) || error.code !== "QUESTION_NOT_PENDING") throw error;
        const current = await this.#store.read(document.requestId);
        if (current) accept(current);
        if (!terminal) throw error;
      }
    };
    const cancel = (): Promise<void> =>
      persistTerminal(
        Object.freeze({ ...document, status: "cancelled", answers: null, updatedAtMs: this.#now() })
      );
    const onAbort = (): void => {
      if (this.#suspended) {
        outcome.reject(
          signal?.reason instanceof Error ? signal.reason : new Error("提问已保存，等待明确继续。")
        );
        return;
      }
      void cancel().catch(outcome.reject);
    };
    this.#settlers.set(document.requestId, accept);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const late = (async () => {
        // 等待者先登记再重读持久事实，封住首次保存后、临时窗口建立前已经答复的空隙。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const current = await this.#store.read(document.requestId);
        if (current) accept(current);
        if (signal?.aborted) {
          onAbort();
          return;
        }
        if (closed || terminal || this.#suspended) return;
        let answers: AgentQuestionAnswers;
        try {
          answers = await prompt(request);
        } catch {
          await cancel();
          return;
        }
        if (closed || terminal || this.#suspended) return;
        const validated = validateAnswers(document.questions, answers);
        if (validated === null) {
          await cancel();
          return;
        }
        await persistTerminal(
          Object.freeze({
            ...document,
            status: "answered",
            answers: validated,
            updatedAtMs: this.#now(),
          })
        );
      })();
      this.#lateChains.set(document.requestId, late.catch(outcome.reject));
      const saved = await outcome.promise;
      return saved.status === "answered" && saved.answers !== null
        ? this.#answered(document.requestId, saved.answers, false)
        : this.#cancelled(document.requestId, false);
    } finally {
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      livePrompt.abort();
      this.#livePrompts.delete(livePrompt);
      if (this.#settlers.get(document.requestId) === accept)
        this.#settlers.delete(document.requestId);
      this.#waiting -= 1;
      completion.resolve();
    }
  }

  async #saveCancelled(
    document: QuestionDocument,
    expectedStatus?: QuestionDocumentStatus
  ): Promise<void> {
    await this.#save(
      Object.freeze({
        ...document,
        status: "cancelled",
        answers: null,
        updatedAtMs: this.#now(),
      }),
      expectedStatus
    );
  }

  async #save(document: QuestionDocument, expectedStatus?: QuestionDocumentStatus): Promise<void> {
    try {
      await this.#store.save(document, expectedStatus);
      this.#settlers.get(document.requestId)?.(document);
    } catch (thrown) {
      if (thrown instanceof QuestionError) throw thrown;
      throw new QuestionError(
        "QUESTION_STORE_FAILED",
        thrown instanceof Error ? thrown.message : String(thrown)
      );
    }
  }

  #answered(
    requestId: string,
    answers: AgentQuestionAnswers,
    replayed: boolean
  ): AskQuestionsResult {
    return Object.freeze({
      requestId,
      status: "answered",
      answers: Object.freeze({ ...answers }),
      replayed,
    });
  }

  #cancelled(requestId: string, replayed: boolean): AskQuestionsResult {
    return Object.freeze({
      requestId,
      status: "cancelled",
      answers: EMPTY_ANSWERS,
      replayed,
    });
  }

  #validateIdentity(input: Pick<AskQuestionsInput, "requestId" | "sessionId">): void {
    if (typeof input.requestId !== "string" || input.requestId.length === 0) {
      throw new QuestionError("QUESTION_INVALID_ARGUMENT", "requestId is required.");
    }
    if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
      throw new QuestionError("QUESTION_INVALID_ARGUMENT", "sessionId is required.");
    }
  }
}

export function normalizeQuestions(
  questions: readonly QuestionInput[]
): readonly NormalizedQuestion[] {
  const rawQuestions: readonly unknown[] = Array.isArray(questions)
    ? (questions as readonly unknown[])
    : [];
  if (rawQuestions.length < 1 || rawQuestions.length > MAX_QUESTIONS) {
    throw new QuestionError(
      "QUESTION_INVALID_ARGUMENT",
      `ask_user needs 1-${MAX_QUESTIONS} questions.`
    );
  }
  const usedKeys = new Set<string>();
  const normalized: NormalizedQuestion[] = [];
  for (let index = 0; index < rawQuestions.length; index += 1) {
    const rawQuestion = rawQuestions[index];
    if (
      !isRecord(rawQuestion) ||
      typeof rawQuestion.question !== "string" ||
      rawQuestion.question.trim().length === 0
    ) {
      throw new QuestionError("QUESTION_INVALID_ARGUMENT", "Each question needs text.");
    }
    const rawOptions: readonly unknown[] = Array.isArray(rawQuestion.options)
      ? (rawQuestion.options as readonly unknown[])
      : [];
    if (rawOptions.length > MAX_OPTIONS) {
      throw new QuestionError(
        "QUESTION_INVALID_ARGUMENT",
        `At most ${MAX_OPTIONS} options per question are allowed.`
      );
    }
    const options: QuestionOptionInput[] = [];
    for (const rawOption of rawOptions) {
      if (
        !isRecord(rawOption) ||
        typeof rawOption.label !== "string" ||
        rawOption.label.trim().length === 0
      ) {
        throw new QuestionError("QUESTION_INVALID_ARGUMENT", "Each option needs a label.");
      }
      options.push(
        Object.freeze({
          label: rawOption.label,
          ...(typeof rawOption.description === "string"
            ? { description: rawOption.description }
            : {}),
        })
      );
    }
    const allowOther = rawQuestion.allowOther === true;
    if (options.length === 0 && !allowOther) {
      throw new QuestionError(
        "QUESTION_INVALID_ARGUMENT",
        "A question without options must allow other text."
      );
    }
    const providedKey = rawQuestion.answerKey;
    if (
      providedKey !== undefined &&
      (typeof providedKey !== "string" || providedKey.trim().length === 0)
    ) {
      throw new QuestionError("QUESTION_INVALID_ARGUMENT", "answerKey must be non-empty text.");
    }
    const answerKey = (typeof providedKey === "string" ? providedKey : `q${index + 1}`).trim();
    if (usedKeys.has(answerKey)) {
      throw new QuestionError("QUESTION_INVALID_ARGUMENT", `Duplicate answerKey "${answerKey}".`);
    }
    usedKeys.add(answerKey);
    const header = typeof rawQuestion.header === "string" ? rawQuestion.header : undefined;
    normalized.push(
      Object.freeze({
        question: rawQuestion.question,
        ...(header !== undefined ? { header } : {}),
        options: Object.freeze([...options]),
        multiSelect: rawQuestion.multiSelect === true,
        allowOther,
        answerKey,
      })
    );
  }
  return Object.freeze(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateAnswers(
  questions: readonly NormalizedQuestion[],
  answers: AgentQuestionAnswers
): AgentQuestionAnswers | null {
  const validated: AgentQuestionAnswers = {};
  for (const question of questions) {
    const raw = answers[question.answerKey];
    if (raw === undefined) continue;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (question.options.length === 0) {
      validated[question.answerKey] = trimmed;
      continue;
    }
    const labels = question.options.map((option) => option.label);
    if (question.multiSelect) {
      const selected = [
        ...new Set(
          trimmed
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        ),
      ];
      if (selected.length === 0) continue;
      const everyKnown = selected.every((label) => labels.includes(label));
      if (everyKnown) {
        validated[question.answerKey] = selected.join(", ");
        continue;
      }
      if (question.allowOther) {
        validated[question.answerKey] = trimmed;
        continue;
      }
      return null;
    }
    if (labels.includes(trimmed)) {
      validated[question.answerKey] = trimmed;
      continue;
    }
    if (question.allowOther) {
      validated[question.answerKey] = trimmed;
      continue;
    }
    return null;
  }
  return validated;
}

function toAgentQuestion(question: NormalizedQuestion): AgentQuestion {
  return {
    question: question.question,
    ...(question.header !== undefined ? { header: question.header } : {}),
    options: question.options.map((option) => ({ ...option })),
    multiSelect: question.multiSelect,
    answerKey: question.answerKey,
    allowOther: question.allowOther,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
