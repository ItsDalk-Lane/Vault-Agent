import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type { BackendProcess } from "@/agentMode/session/types";

export function createHistoryBackend(): BackendProcess {
  const unsupported = async (): Promise<never> => {
    throw new MethodUnsupportedError(
      "historical chat is read-only; start a new Pi chat to continue"
    );
  };
  const noop = (): void => undefined;
  const done = async (): Promise<void> => undefined;
  return {
    start: done,
    isRunning: () => true,
    onExit: () => noop,
    setPermissionPrompter: noop,
    setUnhealthyHandler: noop,
    setAskUserQuestionPrompter: noop,
    setReadOnlySessionPredicate: noop,
    registerSessionHandler: () => noop,
    newSession: unsupported,
    prompt: unsupported,
    cancel: done,
    closeSession: done,
    setSessionModel: unsupported,
    isSetSessionModelSupported: () => false,
    setSessionMode: unsupported,
    isSetSessionModeSupported: () => false,
    setSessionConfigOption: unsupported,
    isSetSessionConfigOptionSupported: () => false,
    listSessions: async () => ({ sessions: [] }),
    resumeSession: unsupported,
    loadSession: unsupported,
    shutdown: done,
  };
}
