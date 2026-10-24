import type { AskUserQuestionPrompter } from "@/agentMode/session/AgentSessionManager";
import type { SessionId } from "@/agentMode/session/types";
import {
  Questions,
  type AskQuestionsInput,
  type AskQuestionsResult,
  type QuestionInput,
} from "@/agentMode/sdk/pi/features/Questions";

// The bridge connects the durable ask_user service to the existing AskUserQuestionPrompter: the
// persisted requestId/questions are handed to the same UI prompter the rest of the plugin uses,
// and the validated answer still goes through Questions so it is stored before the tool resolves:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface QuestionBridgeOptions {
  readonly questions: Questions;
  readonly prompter: AskUserQuestionPrompter;
  readonly sessionId: SessionId;
}

export interface AskWithBridgeInput {
  readonly requestId: string;
  readonly questions: readonly QuestionInput[];
  readonly signal?: AbortSignal;
}

export class QuestionBridge {
  readonly #questions: Questions;
  readonly #prompter: AskUserQuestionPrompter;
  readonly #sessionId: SessionId;

  constructor(options: QuestionBridgeOptions) {
    this.#questions = options.questions;
    this.#prompter = options.prompter;
    this.#sessionId = options.sessionId;
  }

  async ask(input: AskWithBridgeInput): Promise<AskQuestionsResult> {
    const request: AskQuestionsInput = {
      requestId: input.requestId,
      sessionId: this.#sessionId,
      questions: input.questions,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    };
    return this.#questions.ask(request, (prompt) => this.#prompter(prompt));
  }
}
