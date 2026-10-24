import { execFileSync } from "node:child_process";
import path from "node:path";
import type { VaultAgentSettings } from "@/settings/model";
import { configuredPiCatalog } from "./PiRuntimeModels";

describe("PiRuntimeModels", () => {
  describe("configuredPiCatalog()", () => {
    it("excludes disabled providers without losing models or their individual switches and restores them when enabled https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const settings = {
        providers: {
          saved: {
            providerId: "saved",
            providerType: "openai-compatible",
            baseUrl: "https://example.com/v1",
            origin: { kind: "byok" },
            enabled: false,
          },
        },
        configuredModels: [
          { configuredModelId: "model", providerId: "saved", info: { id: "wire-model" } },
        ],
        backends: { pi: { enabledModels: ["model"] } },
      } as unknown as VaultAgentSettings;
      expect(configuredPiCatalog(settings).models).toEqual([]);
      expect(settings.backends.pi?.enabledModels).toEqual(["model"]);
      const restored = {
        ...settings,
        providers: { saved: { ...settings.providers.saved, enabled: true } },
      };
      expect(
        configuredPiCatalog(restored).readyModels.map((model) => model.configuredModelId)
      ).toEqual(["model"]);
    });
    it("uses a known saved provider default but excludes an unknown host instead of routing it to OpenAI https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const settings = {
        providers: {
          known: {
            providerId: "known",
            providerType: "anthropic",
            origin: { kind: "byok", catalogProviderId: "anthropic" },
          },
          unknown: {
            providerId: "unknown",
            providerType: "openai-compatible",
            origin: { kind: "byok" },
          },
        },
        configuredModels: [
          { configuredModelId: "known-model", providerId: "known", info: { id: "known" } },
          { configuredModelId: "unknown-model", providerId: "unknown", info: { id: "unknown" } },
        ],
      } as unknown as VaultAgentSettings;
      expect(
        configuredPiCatalog(settings).readyModels.map((model) => ({
          id: model.configuredModelId,
          url: model.baseUrl,
        }))
      ).toEqual([{ id: "known-model", url: "https://api.anthropic.com" }]);
    });
    it("changes the catalog identity when structured output or native system message support changes so live guards reject stale requests https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const settings = {
        providers: {
          saved: {
            providerId: "saved",
            providerType: "openai-compatible",
            baseUrl: "https://example.com/v1",
            origin: { kind: "byok" },
          },
        },
        configuredModels: [
          {
            configuredModelId: "model",
            providerId: "saved",
            info: {
              id: "wire-model",
              capabilities: { structuredOutput: false, midConversationSystemMessages: false },
            },
          },
        ],
      } as unknown as VaultAgentSettings;
      const initial = JSON.stringify(configuredPiCatalog(settings).readyModels);
      const updated = {
        ...settings,
        configuredModels: [
          {
            ...settings.configuredModels[0],
            info: {
              ...settings.configuredModels[0].info,
              capabilities: { structuredOutput: true, midConversationSystemMessages: true },
            },
          },
        ],
      };
      expect(JSON.stringify(configuredPiCatalog(updated).readyModels)).not.toEqual(initial);
    });
    it("binds saved BYOK identity and capabilities while excluding embedding and subscription execution https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const settings = {
        providers: {
          local: {
            providerId: "local",
            providerType: "openai-compatible",
            origin: { kind: "byok" },
            baseUrl: "http://127.0.0.1:4321/v1",
          },
          old: { providerId: "old", providerType: "openai-compatible", origin: { kind: "agent" } },
        },
        configuredModels: [
          {
            configuredModelId: "saved",
            providerId: "local",
            info: {
              id: "upstream",
              toolCall: true,
              reasoning: true,
              modalities: { input: ["image", "text"] },
            },
          },
          {
            configuredModelId: "embedding",
            providerId: "local",
            info: { id: "embedding", isEmbedding: true },
          },
          { configuredModelId: "legacy", providerId: "old", info: { id: "subscription" } },
        ],
      } as unknown as VaultAgentSettings;
      const catalog = configuredPiCatalog(settings);
      expect(catalog.readyModels).toHaveLength(1);
      expect(catalog.readyModels[0]).toMatchObject({
        configuredModelId: "saved",
        providerInstanceId: "local",
        upstreamModelId: "upstream",
        baseUrl: "http://127.0.0.1:4321/v1",
        capabilities: { supportsTools: true, supportsImages: true, supportsThinking: true },
      });
      expect(catalog.models.some((model) => model.configuredModelId === "embedding")).toBe(false);
    });
  });
  describe("createPiModels()", () => {
    it("sends declared capabilities and reasoning efforts using the selected protocol after a format switch https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "modelCapabilities"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        })
      );
      expect(report).toMatchObject({ status: "passed", requests: 7 });
      expect(report.checks).toContain("protocol_switch_does_not_reuse_google_effort_wire_names");
    }, 65_000);

    it("identifies same-model child requests and refuses endpoint changes or disabled providers during dispatch https://github.com/ItsDalk-Lane/Vault-Agent/issues/1 https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "dispatch"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        })
      ) as {
        status: string;
        providerCalls: number;
        purposes: readonly string[];
        checks: readonly string[];
      };
      expect(report).toMatchObject({
        status: "passed",
        providerCalls: 3,
      });
      expect(report.purposes.filter((purpose) => purpose !== "compaction")).toEqual([
        "root",
        "subagent",
        "root",
      ]);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          "provider_session_identity_for_same_model_child",
          "endpoint_change_during_guard_denied",
          "provider_disabled_during_guard_denied",
          "actual_local_request_budget_is_visible",
          "reopen_restores_local_budget_without_model_call",
          "followup_preserves_work_identity_and_cumulative_budget_before_provider",
        ])
      );
    }, 65_000);

    it("streams a real protocol response from an explicitly keyless local endpoint without sending an authorization header https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "models"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        })
      ) as { status: string; requests: number };
      expect(report).toMatchObject({ status: "passed", requests: 1 });
    }, 65_000);

    it("retains OpenCode session identity and OpenAI organization headers with request overrides without affecting other protocols https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "openCodeSession"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        })
      ) as { status: string; checks: readonly string[]; requests: number };
      expect(report).toMatchObject({ status: "passed", requests: 9 });
      expect(report.checks).toEqual([
        "opencode_session_header_present",
        "opencode_session_header_stable",
        "other_provider_unaffected",
        "host_stream_transport_for_openai_and_anthropic",
        "google_does_not_receive_unsupported_fetch",
        "organization_header_preserved_with_case_insensitive_request_priority",
      ]);
    }, 65_000);
  });
});
