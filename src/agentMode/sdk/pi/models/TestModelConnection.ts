import type { ModelConnectionTestInput } from "@/types/modelConnectionTest";
import { createPiModels } from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";
import { desktopProviderFetch } from "@/utils/desktopProviderFetch";
import { t } from "@/i18n";

const MINIMAL_CONNECTION_PROMPT = "ping";

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The model test was cancelled.", "AbortError");
}

export async function testModelConnection(input: ModelConnectionTestInput): Promise<void> {
  throwIfCancelled(input.signal);
  const controller = new AbortController();
  const signal = controller.signal;
  const cancel = () => controller.abort();
  input.signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30_000);
  try {
    const providerId = "connection-test";
    const credentialId = "connection-test-key";
    // 草稿测试复用聊天装配，但密钥、会话和模型都不落盘。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    const runtime = await createPiModels({
      settings: {
        providers: {
          [providerId]: {
            ...input.provider,
            providerId,
            enabled: true,
            apiKeyKeychainId: credentialId,
          },
        },
        configuredModels: [
          {
            configuredModelId: "connection-test-model",
            providerId,
            info: input.model,
            configuredAt: Date.now(),
          },
        ],
      },
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "connection-test",
        getSecretById: (id) => (id === credentialId ? input.apiKey || null : null),
        setSecretById: () => {
          throw new Error("Connection tests cannot save credentials.");
        },
        deleteSecretById: () => {
          throw new Error("Connection tests cannot delete credentials.");
        },
      },
      fetch: desktopProviderFetch,
    });
    throwIfCancelled(signal);
    const model = runtime.models.getModel(providerId, input.model.id);
    if (!model) throw new Error(t("ui.byok.testUnavailable"));
    const result = await runtime.models.complete(
      model,
      { messages: [{ role: "user", content: MINIMAL_CONNECTION_PROMPT, timestamp: Date.now() }] },
      { signal, maxTokens: 256 }
    );
    throwIfCancelled(signal);
    if (result.stopReason === "error" || result.stopReason === "aborted")
      throw new Error(result.errorMessage || t("ui.byok.testNoReply"));
    // 推理内容也证明请求已到达模型，不能因短测试未产生正文而误报失败。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    if (
      !result.content.some(
        (part) =>
          (part.type === "text" && part.text.trim().length > 0) ||
          (part.type === "thinking" && part.thinking.trim().length > 0)
      )
    )
      throw new Error(t("ui.byok.testNoReply"));
    if (input.checkTools && input.model.toolCall !== false) {
      const messages: import("@earendil-works/pi-ai").Message[] = [
        {
          role: "user",
          content:
            "Call connection_probe once, then reply with exactly the result it returns. Do not guess the result.",
          timestamp: Date.now(),
        },
      ];
      const tools = [
        {
          name: "connection_probe",
          description:
            "Return a fresh verification token. Takes no arguments and accesses no files or services.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          } as import("@earendil-works/pi-ai").TSchema,
        },
      ];
      const callResult = await runtime.models.complete(
        model,
        { messages, tools },
        { signal, maxTokens: 256 }
      );
      throwIfCancelled(signal);
      const calls = callResult.content.filter((part) => part.type === "toolCall");
      if (
        callResult.stopReason === "error" ||
        callResult.stopReason === "aborted" ||
        calls.length !== 1 ||
        calls[0].name !== "connection_probe" ||
        !calls[0].arguments ||
        typeof calls[0].arguments !== "object" ||
        Array.isArray(calls[0].arguments) ||
        Object.keys(calls[0].arguments).length !== 0
      )
        throw new Error(t("ui.byok.testToolCallFailed"));
      const token = `verified-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      messages.push(callResult, {
        role: "toolResult",
        toolCallId: calls[0].id,
        toolName: "connection_probe",
        content: [{ type: "text", text: token }],
        isError: false,
        timestamp: Date.now(),
      });
      const verified = await runtime.models.complete(
        model,
        { messages, tools },
        { signal, maxTokens: 256 }
      );
      throwIfCancelled(signal);
      if (
        verified.stopReason === "error" ||
        verified.stopReason === "aborted" ||
        !verified.content.some((part) => part.type === "text" && part.text.includes(token))
      )
        throw new Error(t("ui.byok.testToolResultFailed"));
    }
  } catch (error) {
    if (timedOut) throw new Error(t("ui.byok.testTimeout"));
    throw error;
  } finally {
    window.clearTimeout(timer);
    input.signal?.removeEventListener("abort", cancel);
  }
}
