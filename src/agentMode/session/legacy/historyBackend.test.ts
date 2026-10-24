import { createHistoryBackend } from "@/agentMode/session/legacy/historyBackend";
import { MethodUnsupportedError } from "@/agentMode/session/errors";

describe("historyBackend", () => {
  describe("createHistoryBackend()", () => {
    it("supports read-only view lifecycle without starting any process https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const backend = createHistoryBackend();
      await backend.start?.();
      expect(backend.isRunning()).toBe(true);
      expect(backend.listSessions).toBeDefined();
      expect(await backend.listSessions({ cwd: "/vault" })).toEqual({ sessions: [] });
      expect(backend.isSetSessionModelSupported()).toBe(false);
      expect(backend.isSetSessionModeSupported()).toBe(false);
      expect(backend.isSetSessionConfigOptionSupported()).toBe(false);
      const listener = jest.fn();
      backend.onExit(listener)();
      backend.registerSessionHandler("old", listener)();
      backend.setPermissionPrompter(async () => ({ outcome: { outcome: "cancelled" } }));
      backend.setUnhealthyHandler?.(listener);
      backend.setAskUserQuestionPrompter?.(async () => ({}));
      backend.setReadOnlySessionPredicate?.(() => true);
      await backend.cancel({ sessionId: "old" });
      await backend.closeSession?.({ sessionId: "old" });
      await backend.shutdown();
      expect(listener).not.toHaveBeenCalled();
    });

    it("refuses execution, new sessions, configuration changes and execution-based history replay https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const backend = createHistoryBackend();
      await expect(backend.newSession({ cwd: "/vault" })).rejects.toBeInstanceOf(
        MethodUnsupportedError
      );
      await expect(
        backend.prompt({ sessionId: "old", prompt: [{ type: "text", text: "continue" }] })
      ).rejects.toBeInstanceOf(MethodUnsupportedError);
      await expect(
        backend.setSessionModel({ sessionId: "old", modelId: "model" })
      ).rejects.toBeInstanceOf(MethodUnsupportedError);
      await expect(
        backend.setSessionMode({ sessionId: "old", modeId: "default" })
      ).rejects.toBeInstanceOf(MethodUnsupportedError);
      await expect(
        backend.setSessionConfigOption({ sessionId: "old", configId: "effort", value: "low" })
      ).rejects.toBeInstanceOf(MethodUnsupportedError);
      await expect(backend.loadSession({ sessionId: "old", cwd: "/vault" })).rejects.toBeInstanceOf(
        MethodUnsupportedError
      );
      await expect(
        backend.resumeSession({ sessionId: "old", cwd: "/vault" })
      ).rejects.toBeInstanceOf(MethodUnsupportedError);
    });
  });
});
