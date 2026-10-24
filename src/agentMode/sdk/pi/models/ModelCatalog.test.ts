import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ENGINE_ID,
  createConfiguredModelId,
  credentialDomainId,
  normalizeEndpoint,
  parseConfiguredModelId,
} from "./ModelIdentity";
import {
  buildModelCatalog,
  mapProviderProtocol,
  type ExistingConfiguredModel,
  type ExistingProviderBinding,
} from "./ModelCatalog";

// Existing Vault Agent model configs become the Pi model catalog: engine, provider
// instance and model key stay separate, the four supported protocols map explicitly,
// unknown configs are retained as needs-protocol, thinking effort only exists when the
// model supports reasoning, and same-name models on different endpoints never share
// credentials: https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");

const anthropicProvider: ExistingProviderBinding = {
  providerId: "prov-instance-anthropic",
  providerType: "anthropic",
  displayName: "Anthropic",
  baseUrl: "https://api.anthropic.com",
};

const openaiResponsesProvider: ExistingProviderBinding = {
  providerId: "prov-instance-openai",
  providerType: "openai-compatible",
  displayName: "OpenAI",
  baseUrl: "https://api.openai.com",
  useResponsesApi: true,
};

const openaiCompatibleProvider: ExistingProviderBinding = {
  providerId: "prov-instance-local",
  providerType: "openai-compatible",
  displayName: "Local gateway",
  baseUrl: "http://localhost:1234",
  useResponsesApi: false,
};

const googleProvider: ExistingProviderBinding = {
  providerId: "prov-instance-google",
  providerType: "google",
  displayName: "Google",
  baseUrl: "https://generativelanguage.googleapis.com",
};

function model(
  overrides: Partial<ExistingConfiguredModel> & { providerId: string }
): ExistingConfiguredModel {
  return {
    upstreamModelId: "claude-sonnet",
    displayName: "Claude Sonnet",
    toolCall: true,
    reasoning: true,
    reasoningEfforts: ["low", "medium", "high"],
    capabilities: ["vision"],
    contextWindow: 200_000,
    ...overrides,
  };
}

describe("ModelIdentity", () => {
  it("keeps the fixed engine id separate from provider instances and model keys", () => {
    expect(ENGINE_ID).toBe("pi");
    const configuredModelId = createConfiguredModelId("prov-instance-openai", "gpt-4o");
    expect(configuredModelId).not.toBe("pi");
    expect(parseConfiguredModelId(configuredModelId)).toEqual({
      providerInstanceId: "prov-instance-openai",
      upstreamModelId: "gpt-4o",
    });
  });

  it("round-trips model ids containing separators", () => {
    const configuredModelId = createConfiguredModelId("prov-instance-x", "anthropic/claude:sonnet");
    expect(parseConfiguredModelId(configuredModelId)).toEqual({
      providerInstanceId: "prov-instance-x",
      upstreamModelId: "anthropic/claude:sonnet",
    });
    expect(parseConfiguredModelId("not-a-configured-model-id")).toBeNull();
  });

  it("normalizes endpoints before fingerprinting them", () => {
    const first = normalizeEndpoint("openai-completions", "https://API.Example.com/v1///");
    const second = normalizeEndpoint("openai-completions", "https://api.example.com/v1");
    expect(first).toBe(second);
    expect(normalizeEndpoint("openai-responses", "https://api.example.com/v1")).not.toBe(first);
  });

  it("isolates the credential domain per provider instance and endpoint", () => {
    const sameInstance = credentialDomainId(
      "prov-instance-openai",
      "openai-responses",
      "https://api.openai.com/v1",
      sha256
    );
    const sameIdOtherEndpoint = credentialDomainId(
      "prov-instance-openai",
      "openai-responses",
      "https://proxy.example.com/v1",
      sha256
    );
    const otherInstance = credentialDomainId(
      "prov-instance-other",
      "openai-responses",
      "https://api.openai.com/v1",
      sha256
    );

    expect(sameInstance).toMatch(/^pi-cred-[0-9a-f]{16}$/);
    expect(sameIdOtherEndpoint).not.toBe(sameInstance);
    expect(otherInstance).not.toBe(sameInstance);
  });
});

describe("ModelCatalog", () => {
  describe("mapProviderProtocol()", () => {
    it("maps only the four supported protocols explicitly", () => {
      expect(mapProviderProtocol(anthropicProvider)).toBe("anthropic-messages");
      expect(mapProviderProtocol(openaiResponsesProvider)).toBe("openai-responses");
      expect(mapProviderProtocol(openaiCompatibleProvider)).toBe("openai-completions");
      expect(mapProviderProtocol(googleProvider)).toBe("google-generative-ai");
      expect(
        mapProviderProtocol({ ...openaiCompatibleProvider, providerType: "mistral" })
      ).toBeNull();
    });
  });

  describe("buildModelCatalog()", () => {
    it("retains public model and provider labels for model-facing subtask selection https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const catalog = buildModelCatalog(
        {
          providers: [openaiCompatibleProvider],
          models: [
            model({
              configuredModelId: "uuid-local",
              providerId: openaiCompatibleProvider.providerId,
              displayName: "本地审阅",
            }),
          ],
        },
        { sha256 }
      );
      expect(catalog.readyModels[0]).toMatchObject({
        configuredModelId: "uuid-local",
        displayName: "本地审阅",
        providerDisplayName: "Local gateway",
      });
      const unnamed = buildModelCatalog(
        {
          providers: [{ providerId: "unnamed-provider", providerType: "openai-compatible" }],
          models: [{ providerId: "unnamed-provider", upstreamModelId: "upstream-id" }],
        },
        { sha256 }
      );
      expect(unnamed.readyModels[0]).toMatchObject({
        displayName: "upstream-id",
        providerDisplayName: "unnamed-provider",
      });
    });
    it("builds ready entries carrying engine, provider instance, upstream model and protocol", () => {
      const snapshot = buildModelCatalog(
        {
          providers: [anthropicProvider, openaiResponsesProvider, googleProvider],
          models: [
            model({ providerId: anthropicProvider.providerId, upstreamModelId: "claude-sonnet" }),
            model({
              providerId: openaiResponsesProvider.providerId,
              upstreamModelId: "gpt-4o",
              displayName: "GPT-4o",
            }),
            model({
              providerId: googleProvider.providerId,
              upstreamModelId: "gemini-2.5-pro",
              displayName: "Gemini",
            }),
          ],
        },
        { sha256 }
      );

      expect(snapshot.models).toHaveLength(3);
      expect(snapshot.models.map((entry) => entry.api)).toEqual([
        "anthropic-messages",
        "openai-responses",
        "google-generative-ai",
      ]);
      for (const entry of snapshot.models) {
        expect(entry.engineId).toBe("pi");
        expect(entry.status).toBe("ready");
        expect(entry.providerInstanceId).toBeTruthy();
        expect(entry.upstreamModelId).toBeTruthy();
        expect(parseConfiguredModelId(entry.configuredModelId)).not.toBeNull();
      }
    });

    it("does not cross model keys or credential domains for same-named models on different endpoints", () => {
      const first = {
        ...openaiCompatibleProvider,
        providerId: "provider-a",
        displayName: "GPT",
        baseUrl: "https://endpoint-a.example.com/v1",
      };
      const second = {
        ...openaiCompatibleProvider,
        providerId: "provider-b",
        displayName: "GPT",
        baseUrl: "https://endpoint-b.example.com/v1",
      };
      const sharedNameModel = {
        upstreamModelId: "gpt-4o",
        displayName: "GPT-4o",
        toolCall: true,
      };

      const snapshot = buildModelCatalog(
        {
          providers: [first, second],
          models: [
            model({ providerId: "provider-a", ...sharedNameModel }),
            model({ providerId: "provider-b", ...sharedNameModel }),
          ],
          selectedConfiguredModelId: createConfiguredModelId("provider-a", "gpt-4o"),
        },
        { sha256 }
      );

      const byProvider = new Map(snapshot.models.map((entry) => [entry.providerInstanceId, entry]));
      const firstEntry = byProvider.get("provider-a");
      const secondEntry = byProvider.get("provider-b");
      expect(firstEntry).toBeDefined();
      expect(secondEntry).toBeDefined();
      expect(firstEntry?.configuredModelId).not.toBe(secondEntry?.configuredModelId);
      expect(firstEntry?.credentialDomainId).not.toBe(secondEntry?.credentialDomainId);
      expect(firstEntry?.credentialDomainId).toMatch(/^pi-cred-[0-9a-f]{16}$/);

      const selected = snapshot.models.filter((entry) => entry.selected);
      expect(selected).toHaveLength(1);
      expect(selected[0]?.providerInstanceId).toBe("provider-a");
      expect(snapshot.selectedConfiguredModelId).toBe(
        createConfiguredModelId("provider-a", "gpt-4o")
      );
    });

    it("keeps unknown or unmapped configs as needs-protocol instead of deleting or guessing", () => {
      const unknownProvider: ExistingProviderBinding = {
        providerId: "provider-unknown",
        providerType: "mistral",
        displayName: "Mistral",
        baseUrl: "https://api.mistral.ai",
      };
      const snapshot = buildModelCatalog(
        {
          providers: [unknownProvider, anthropicProvider],
          models: [
            model({ providerId: "provider-unknown", upstreamModelId: "mistral-large" }),
            model({ providerId: "missing-provider", upstreamModelId: "ghost-model" }),
            model({ providerId: anthropicProvider.providerId }),
          ],
        },
        { sha256 }
      );

      expect(snapshot.models).toHaveLength(3);
      expect(snapshot.unknownConfigs.map((entry) => entry.upstreamModelId)).toEqual([
        "mistral-large",
        "ghost-model",
      ]);
      for (const entry of snapshot.unknownConfigs) {
        expect(entry.status).toBe("needs_protocol");
        expect(entry.api).toBeNull();
        expect(entry.retained).toBe(true);
      }
      expect(snapshot.models.filter((entry) => entry.status === "ready")).toHaveLength(1);
    });

    it("offers no thinking effort when the model does not support thinking", () => {
      const snapshot = buildModelCatalog(
        {
          providers: [anthropicProvider],
          models: [
            model({
              providerId: anthropicProvider.providerId,
              upstreamModelId: "claude-no-thinking",
              reasoning: false,
              reasoningEfforts: undefined,
            }),
          ],
          selectedConfiguredModelId: createConfiguredModelId(
            anthropicProvider.providerId,
            "claude-no-thinking"
          ),
        },
        { sha256 }
      );

      const entry = snapshot.models[0];
      expect(entry.capabilities.supportsThinking).toBe(false);
      expect(entry.capabilities.thinkingEfforts).toEqual([]);
      expect(entry.selected).toBe(true);
    });

    it("preserves user declared custom thinking levels for the model picker https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const snapshot = buildModelCatalog(
        {
          providers: [{ ...anthropicProvider, providerType: "openai-compatible" }],
          models: [
            model({
              providerId: anthropicProvider.providerId,
              reasoning: true,
              reasoningEfforts: ["minimal", "medium", "xhigh", "unsupported-level", "high"],
            }),
          ],
        },
        { sha256 }
      );

      expect(snapshot.models[0].capabilities.thinkingEfforts).toEqual([
        "minimal",
        "medium",
        "xhigh",
        "unsupported-level",
        "high",
      ]);
    });

    it("keeps public thinking capability without inventing undeclared effort levels https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const snapshot = buildModelCatalog(
        {
          providers: [anthropicProvider],
          models: [
            model({
              providerId: anthropicProvider.providerId,
              reasoning: true,
              reasoningEfforts: undefined,
            }),
          ],
        },
        { sha256 }
      );
      expect(snapshot.models[0].capabilities.supportsThinking).toBe(true);
      expect(snapshot.models[0].capabilities.thinkingEfforts).toEqual([]);
    });

    it("inherits image and tool-calling capabilities and flags missing tool calling", () => {
      const snapshot = buildModelCatalog(
        {
          providers: [anthropicProvider],
          models: [
            model({
              providerId: anthropicProvider.providerId,
              capabilities: ["vision"],
              toolCall: true,
            }),
            model({
              providerId: anthropicProvider.providerId,
              upstreamModelId: "claude-no-tools",
              capabilities: ["reasoning"],
              toolCall: false,
            }),
          ],
        },
        { sha256 }
      );

      expect(snapshot.models[0].capabilities.supportsImages).toBe(true);
      expect(snapshot.models[0].capabilities.supportsTools).toBe(true);
      expect(snapshot.models[1].capabilities.supportsTools).toBe(false);
      expect(snapshot.models[1].status).toBe("unsupported_tool_calling");
      expect(snapshot.models[1].retained).toBe(true);
    });

    it("keeps the recorded selection even when the selected model is not ready", () => {
      const snapshot = buildModelCatalog(
        {
          providers: [anthropicProvider],
          models: [
            model({
              providerId: anthropicProvider.providerId,
              toolCall: false,
              upstreamModelId: "claude-no-tools",
            }),
          ],
          selectedConfiguredModelId: createConfiguredModelId(
            anthropicProvider.providerId,
            "claude-no-tools"
          ),
        },
        { sha256 }
      );

      expect(snapshot.selectedConfiguredModelId).toBe(
        createConfiguredModelId(anthropicProvider.providerId, "claude-no-tools")
      );
      expect(snapshot.models[0].status).toBe("unsupported_tool_calling");
    });

    it("builds the catalog without any CLI, process or network probing", () => {
      const catalogSource = fs.readFileSync(path.join(__dirname, "ModelCatalog.ts"), "utf8");
      const identitySource = fs.readFileSync(path.join(__dirname, "ModelIdentity.ts"), "utf8");
      for (const source of [catalogSource, identitySource]) {
        expect(source).not.toMatch(/child_process|execFile|spawn\(|fetch\(|probeModels|requestUrl/);
      }
      const snapshot = buildModelCatalog(
        {
          providers: [anthropicProvider],
          models: [model({ providerId: anthropicProvider.providerId })],
        },
        { sha256 }
      );
      expect(snapshot.models).toHaveLength(1);
    });
  });
});
