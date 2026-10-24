import type { ModelConnectionTestInput } from "@/types/modelConnectionTest";
import { testModelConnection } from "./TestModelConnection";
import { createPiModels } from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";
import { desktopProviderFetch } from "@/utils/desktopProviderFetch";

jest.mock("@/agentMode/sdk/pi/runtime/PiRuntimeModels", () => ({ createPiModels: jest.fn() }));
jest.mock("@/utils/desktopProviderFetch", () => ({ desktopProviderFetch: jest.fn() }));

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";
const create = jest.mocked(createPiModels);
const complete = jest.fn();
const getModel = jest.fn();
const input = (): ModelConnectionTestInput => ({
  provider: {
    providerId: "saved-provider",
    providerType: "openai-compatible",
    displayName: "OpenCode Go",
    baseUrl: "https://opencode.ai/inference/go/v1",
    origin: { kind: "byok", catalogProviderId: "opencode-go" },
    addedAt: 1,
    enabled: false,
  },
  model: { id: "draft-model", displayName: "Draft model", reasoning: true },
  apiKey: "draft-key-fixture",
});

function options() {
  return create.mock.calls[0][0];
}

describe("TestModelConnection", () => {
  describe("testModelConnection()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      complete.mockReset();
      getModel.mockReturnValue({ id: "draft-model" });
      complete.mockResolvedValue({ stopReason: "stop", content: [{ type: "text", text: "pong" }] });
      create.mockResolvedValue({ models: { getModel, complete } } as unknown as Awaited<
        ReturnType<typeof createPiModels>
      >);
    });

    it(`uses the real runtime and a memory-only draft credential to request ping without notes, tools or persistence (${ISSUE})`, async () => {
      const draft = input();
      const before = JSON.stringify(draft);
      const controller = new AbortController();
      await testModelConnection({ ...draft, signal: controller.signal });
      expect(JSON.stringify(draft)).toBe(before);
      expect(options().fetch).toBe(desktopProviderFetch);
      expect(options().settings.providers["connection-test"]).toMatchObject({
        baseUrl: draft.provider.baseUrl,
        origin: draft.provider.origin,
        enabled: true,
        apiKeyKeychainId: "connection-test-key",
      });
      expect(options().settings.configuredModels[0].info).toEqual(draft.model);
      expect(options().keychain.isAvailable()).toBe(true);
      expect(options().keychain.getVaultId()).toBe("connection-test");
      expect(options().keychain.getSecretById("connection-test-key")).toBe("draft-key-fixture");
      expect(options().keychain.getSecretById("unknown")).toBeNull();
      expect(() => options().keychain.setSecretById("anything", "value")).toThrow("cannot save");
      expect(() => options().keychain.deleteSecretById("anything")).toThrow("cannot delete");
      expect(complete).toHaveBeenCalledWith(
        { id: "draft-model" },
        { messages: [{ role: "user", content: "ping", timestamp: expect.any(Number) }] },
        { signal: expect.any(AbortSignal), maxTokens: 256 }
      );
    });

    it("verifies a model reads an actual tool result without accessing user data https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      complete
        .mockResolvedValueOnce({ stopReason: "stop", content: [{ type: "text", text: "pong" }] })
        .mockResolvedValueOnce({
          stopReason: "toolUse",
          content: [
            { type: "toolCall", id: "probe-call", name: "connection_probe", arguments: {} },
          ],
        })
        .mockImplementationOnce(async (_model, context) => ({
          stopReason: "stop",
          content: [{ type: "text", text: context.messages.at(-1).content[0].text }],
        }));
      await expect(testModelConnection({ ...input(), checkTools: true })).resolves.toBeUndefined();
      expect(complete).toHaveBeenCalledTimes(3);
      expect(complete.mock.calls[2][1].messages.at(-1)).toMatchObject({
        role: "toolResult",
        toolCallId: "probe-call",
        toolName: "connection_probe",
      });
    });

    it.each([
      { stopReason: "error", arguments: {} },
      { stopReason: "toolUse", arguments: [] },
    ])(
      "rejects a failed or malformed tool response instead of reporting tool compatibility: %j https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (reply) => {
        complete.mockResolvedValueOnce({
          stopReason: "stop",
          content: [{ type: "text", text: "pong" }],
        });
        complete.mockResolvedValueOnce({
          stopReason: reply.stopReason,
          content: [
            { type: "toolCall", id: "probe", name: "connection_probe", arguments: reply.arguments },
          ],
        });
        complete.mockImplementation(async (_model, context) => ({
          stopReason: "stop",
          content: [{ type: "text", text: context.messages.at(-1).content[0].text }],
        }));
        await expect(testModelConnection({ ...input(), checkTools: true })).rejects.toThrow(
          /Connected|连接/
        );
        expect(complete).toHaveBeenCalledTimes(2);
      }
    );

    it.each(["missing_call", "unread_result"])(
      "reports connected but incompatible when tool verification fails: %s https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (reason) => {
        complete.mockResolvedValueOnce({
          stopReason: "stop",
          content: [{ type: "text", text: "pong" }],
        });
        if (reason === "unread_result")
          complete.mockResolvedValueOnce({
            stopReason: "toolUse",
            content: [{ type: "toolCall", id: "probe", name: "connection_probe", arguments: {} }],
          });
        complete.mockResolvedValue({
          stopReason: "stop",
          content: [{ type: "text", text: "guess" }],
        });
        await expect(testModelConnection({ ...input(), checkTools: true })).rejects.toThrow(
          /Connected|连接/
        );
      }
    );

    it(`allows an explicitly keyless model to test without a saved credential (${ISSUE})`, async () => {
      const draft = input();
      await testModelConnection({
        ...draft,
        provider: { ...draft.provider, requiresApiKey: false },
        apiKey: undefined,
      });
      expect(options().keychain.getSecretById("connection-test-key")).toBeNull();
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it(`surfaces the provider failure instead of accepting a successful model list (${ISSUE})`, async () => {
      complete.mockResolvedValue({
        stopReason: "error",
        errorMessage: "Invalid model access",
        content: [],
      });
      await expect(testModelConnection(input())).rejects.toThrow("Invalid model access");
    });

    it.each([
      { stopReason: "stop", content: [] },
      { stopReason: "length", content: [{ type: "text", text: "  " }] },

      { stopReason: "error", content: [] },
      { stopReason: "aborted", content: [] },
    ])(`does not show success without a model reply: %j (${ISSUE})`, async (result) => {
      complete.mockResolvedValue(result);
      await expect(testModelConnection(input())).rejects.toThrow("did not return a model reply");
    });

    it(`accepts a nonempty reasoning reply when the short connection test ends before final text (${ISSUE})`, async () => {
      complete.mockResolvedValue({
        stopReason: "length",
        content: [{ type: "thinking", thinking: "a real model response" }],
      });
      await expect(testModelConnection(input())).resolves.toBeUndefined();
    });

    it(`aborts a provider that exceeds the connection test timeout and reports the timeout (${ISSUE})`, async () => {
      jest.useFakeTimers();
      let started!: () => void;
      const requestStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      complete.mockImplementationOnce(
        (_model, _context, request: { signal: AbortSignal }) =>
          new Promise((resolve) => {
            request.signal.addEventListener(
              "abort",
              () => resolve({ stopReason: "aborted", content: [] }),
              { once: true }
            );
            started();
          })
      );
      try {
        const pending = testModelConnection(input());
        await requestStarted;
        jest.advanceTimersByTime(30_000);
        await expect(pending).rejects.toThrow("timed out");
      } finally {
        jest.useRealTimers();
      }
    });

    it(`reports an unusable model instead of sending a request to a fallback (${ISSUE})`, async () => {
      getModel.mockReturnValue(undefined);
      await expect(testModelConnection(input())).rejects.toThrow("cannot be tested");
      expect(complete).not.toHaveBeenCalled();
    });

    it(`preserves a transport rejection for the settings error message (${ISSUE})`, async () => {
      complete.mockRejectedValue(new Error("socket reset"));
      await expect(testModelConnection(input())).rejects.toThrow("socket reset");
    });

    it(`does not create a runtime or send a request when already cancelled (${ISSUE})`, async () => {
      const controller = new AbortController();
      controller.abort(new Error("cancelled"));
      await expect(testModelConnection({ ...input(), signal: controller.signal })).rejects.toThrow(
        "cancelled"
      );
      expect(create).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it(`does not send a request if the dialog closes while the runtime loads (${ISSUE})`, async () => {
      const controller = new AbortController();
      create.mockImplementationOnce(async () => {
        controller.abort(new Error("cancelled"));
        return { models: { getModel, complete } } as unknown as Awaited<
          ReturnType<typeof createPiModels>
        >;
      });
      await expect(testModelConnection({ ...input(), signal: controller.signal })).rejects.toThrow(
        "cancelled"
      );
      expect(complete).not.toHaveBeenCalled();
    });

    it(`does not report success if cancellation races with the provider reply (${ISSUE})`, async () => {
      const controller = new AbortController();
      complete.mockImplementationOnce(async () => {
        controller.abort(new Error("cancelled"));
        return { stopReason: "stop", content: [{ type: "text", text: "pong" }] };
      });
      await expect(testModelConnection({ ...input(), signal: controller.signal })).rejects.toThrow(
        "cancelled"
      );
    });
  });
});
