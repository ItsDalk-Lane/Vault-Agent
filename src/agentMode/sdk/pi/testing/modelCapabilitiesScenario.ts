import { requireNodeModule } from "@/utils/desktopRuntime";
import type { VaultAgentSettings } from "@/settings/model";
import { createPiModels } from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";
import { preparePiRuntimeInput } from "@/agentMode/sdk/pi/runtime/PiRuntimeInput";
import type { App } from "obsidian";
import { lookupDeclaredModelCapabilities } from "@/agentMode/sdk/pi/models/DeclaredModelCapabilities";

export async function runModelCapabilitiesScenario(privateDir: string) {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
  const requests: Record<string, unknown>[] = [];
  const image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXkAAAAASUVORK5CYII=";
  for (const providerType of ["openai-compatible", "anthropic"] as const) {
    for (const responses of providerType === "anthropic" ? [false] : [false, true]) {
      for (const enabled of [false, true]) {
        const switchedFromGoogle = providerType === "openai-compatible" && !responses && enabled;
        const wireModelId =
          providerType === "anthropic"
            ? "claude-sonnet-4-6"
            : switchedFromGoogle
              ? "gemma-4-31b-it"
              : "test-model";
        const settings = {
          providers: {
            configured: {
              providerId: "configured",
              providerType,
              baseUrl: "https://example.invalid/v1",
              origin: {
                kind: "byok",
                ...(providerType === "anthropic"
                  ? { catalogProviderId: "anthropic" }
                  : switchedFromGoogle
                    ? { catalogProviderId: "google" }
                    : {}),
              },
              extras: { useResponsesApi: responses },
              requiresApiKey: true,
            },
          },
          configuredModels: [
            {
              configuredModelId: "test-model",
              providerId: "configured",
              info: {
                id: wireModelId,
                displayName: "Test model",
                modalities: { input: enabled ? ["text", "image"] : ["text"] },
                reasoning: true,
                reasoningEfforts: ["low", "high", "max", "custom-deep"],
                capabilities: { structuredOutput: enabled, midConversationSystemMessages: enabled },
              },
            },
          ],
        } as unknown as VaultAgentSettings;
        const runtime = await createPiModels({
          settings,
          keychain: {
            isAvailable: () => true,
            getVaultId: () => "capabilities",
            getSecretById: () => "key",
            setSecretById: () => undefined,
            deleteSecretById: () => undefined,
          },
        });
        const model = runtime.models.getModel("configured", wireModelId);
        assert.ok(model);
        const capability = runtime.catalog.readyModels[0];
        const inputOptions = {
          modelKey: capability.configuredModelId,
          acceptsImages: capability.capabilities.supportsImages,
          privateDir,
          app: { vault: { configDir: "fixture-config" } } as App,
        };
        const attachedInput = {
          sessionId: "capabilities",
          prompt: [
            { type: "text" as const, text: "hello" },
            { type: "image" as const, mimeType: "image/png", data: image },
          ],
        };
        if (!enabled) {
          await assert.rejects(
            preparePiRuntimeInput({ ...inputOptions, input: attachedInput }),
            /does not support image attachments/
          );
        }
        const prepared = await preparePiRuntimeInput({
          ...inputOptions,
          input: enabled ? attachedInput : { ...attachedInput, prompt: [attachedInput.prompt[0]] },
        });
        assert.equal(
          prepared.content.some((part) => part.type === "image"),
          enabled
        );
        let payload: Record<string, unknown> | undefined;
        const result = await runtime.models.completeSimple(
          model,
          {
            messages: [
              {
                role: "system",
                content: "initial instruction",
                timestamp: 1,
                toolsAdded: [
                  {
                    name: "example",
                    description: "example tool",
                    parameters: {
                      type: "object",
                      properties: { message: { type: "string" } },
                      required: ["message"],
                    },
                  },
                ],
              },
              { role: "user", content: prepared.content, timestamp: 2 },
              { role: "system", content: "later instruction", timestamp: 3 },
              { role: "user", content: "continue", timestamp: 4 },
            ],
          },
          {
            apiKey: "fixture-key",
            reasoning: (providerType === "openai-compatible" ? "custom-deep" : "max") as "high",
            onPayload: (value) => {
              payload = value as Record<string, unknown>;
              throw new Error("payload captured before network");
            },
          }
        );
        assert.equal(result.stopReason, "error");
        assert.ok(payload);
        requests.push(payload);
        const wireContent = JSON.stringify(payload);
        assert.ok(wireContent.includes("hello"), "text must reach every request");
        assert.equal(
          wireContent.includes(image),
          enabled,
          "image bytes must reach only a model that declared image input"
        );
        const tools = payload.tools as { function?: { strict?: boolean }; strict?: boolean }[];
        const strict =
          responses || providerType === "anthropic" ? tools[0]?.strict : tools[0]?.function?.strict;
        assert.equal(
          strict === true,
          enabled,
          JSON.stringify({ providerType, responses, enabled, kind: "strict", payload })
        );
        const messages = (payload.messages ?? payload.input) as {
          role: string;
          content: unknown;
        }[];
        const later = messages.findIndex(
          (message) =>
            ["system", "developer"].includes(message.role) &&
            JSON.stringify(message.content).includes("later instruction")
        );
        assert.equal(
          later > 0,
          enabled,
          JSON.stringify({ providerType, responses, enabled, kind: "system", payload })
        );
        if (switchedFromGoogle) {
          let switchedPayload: Record<string, unknown> | undefined;
          await runtime.models.completeSimple(
            model,
            { messages: [{ role: "user", content: "high effort", timestamp: 1 }] },
            {
              apiKey: "fixture-key",
              reasoning: "high",
              onPayload: (value) => {
                switchedPayload = value as Record<string, unknown>;
                throw new Error("payload captured before network");
              },
            }
          );
          assert.ok(switchedPayload);
          requests.push(switchedPayload);
          assert.equal(
            switchedPayload.reasoning_effort,
            "high",
            "switching API format must not reuse Google HIGH in an OpenAI request"
          );
        }
        if (providerType === "anthropic") {
          assert.equal((payload.thinking as { type: string }).type, "adaptive");
          assert.equal((payload.output_config as { effort: string }).effort, "max");
        }
        if (providerType === "openai-compatible") {
          assert.equal(
            responses ? (payload.reasoning as { effort: string }).effort : payload.reasoning_effort,
            "custom-deep"
          );
        }
      }
    }
  }
  assert.equal(lookupDeclaredModelCapabilities("unknown-provider", "model"), undefined);
  assert.equal(lookupDeclaredModelCapabilities("openai", "not-a-model"), undefined);
  const declared = lookupDeclaredModelCapabilities("openai", "gpt-5.4");
  assert.ok(declared);
  assert.ok(declared.modalities?.input?.includes("text"));
  return {
    status: "passed",
    requests: requests.length,
    checks: [
      "strict_schema_payload_on_and_off",
      "native_mid_conversation_system_messages_on_and_off",
      "custom_openai_effort_reaches_payload",
      "builtin_declarations_and_unknown_fail_closed",
      "image_declaration_drives_attachment_rejection_and_payload",
      "text_reaches_payload_with_images_enabled_or_disabled",
      "builtin_anthropic_adaptive_max_effort_reaches_payload",
      "protocol_switch_does_not_reuse_google_effort_wire_names",
    ],
  };
}
