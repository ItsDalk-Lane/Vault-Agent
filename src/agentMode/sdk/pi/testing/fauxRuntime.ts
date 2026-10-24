import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { FauxProviderHandle, ToolCall } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";

// Scripts the official pi-ai faux provider so integration tests drive the real Harness
// without network access or real credentials:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface FauxRuntime {
  readonly models: ReturnType<typeof createModels>;
  readonly faux: FauxProviderHandle;
  queueToolCall(name: string, args: ToolCall["arguments"]): void;
  queueAnswer(text: string): void;
  queuedResponses(): number;
}

export function createFauxRuntime(): FauxRuntime {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);

  return {
    models,
    faux,
    queueToolCall(name, args) {
      faux.appendResponses([
        fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
      ]);
    },
    queueAnswer(text) {
      faux.appendResponses([fauxAssistantMessage(text)]);
    },
    queuedResponses: () => faux.getPendingResponseCount(),
  };
}
