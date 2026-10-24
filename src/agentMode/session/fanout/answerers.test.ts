import {
  EMPTY_ANSWERER_MODELS,
  FANOUT_DUPLICATE_MODEL_POLICY,
  FANOUT_MAX_ANSWERERS,
  FANOUT_MIN_ANSWERERS,
  FanoutSelectionError,
  enabledFanoutModels,
  configuredFanoutModels,
  isFanoutModels,
  resolveAnswererModels,
  type FanoutModelOption,
} from "@/agentMode/session/fanout/answerers";
import { FANOUT_ENGINE_ID } from "@/agentMode/session/fanout/fanoutTypes";

// Fan-out selects stable model keys on the single Pi engine: a model without a key is disabled, the
// same model selected twice is deduped by an explicit policy, two keys sharing one configuration
// cannot stand in for two providers:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function model(overrides: Partial<FanoutModelOption> & { modelKey: string }): FanoutModelOption {
  return {
    engineId: FANOUT_ENGINE_ID,
    hasKey: true,
    ...overrides,
  };
}

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(FanoutSelectionError);
    expect((thrown as FanoutSelectionError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("answerers", () => {
  describe("configuredFanoutModels()", () => {
    it("maps saved model ids and credential availability to Pi answerers https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const models = configuredFanoutModels({
        configuredModels: [
          {
            configuredModelId: "first",
            providerId: "p",
            info: { id: "upstream", displayName: "First" },
          },
          {
            configuredModelId: "alias",
            providerId: "p",
            info: { id: "upstream", displayName: "Alias" },
          },
        ],
        backends: { pi: { enabledModels: ["first", "alias"] } },
        providers: {
          p: {
            providerType: "anthropic",
            displayName: "Saved endpoint",
            origin: { kind: "byok" },
            apiKeyKeychainId: "key",
          },
        },
      } as never);
      expect(
        models.map((entry) => [entry.modelKey, entry.engineId, entry.hasKey, entry.label])
      ).toEqual([
        ["first", "pi", true, "First · Saved endpoint"],
        ["alias", "pi", true, "Alias · Saved endpoint"],
      ]);
      expect(models[0].configFingerprint).toBe(models[1].configFingerprint);
    });
    it("omits disabled providers without deleting model switches and restores their answerers when enabled https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const settings = {
        configuredModels: [
          {
            configuredModelId: "saved",
            providerId: "p",
            info: { id: "wire", displayName: "Saved model" },
          },
        ],
        backends: { pi: { enabledModels: ["saved"] } },
        providers: {
          p: {
            providerType: "openai-compatible",
            displayName: "Paused provider",
            origin: { kind: "byok" },
            enabled: false,
            apiKeyKeychainId: "key",
          },
        },
      };
      expect(configuredFanoutModels(settings as never)).toEqual([]);
      expect(settings.backends.pi.enabledModels).toEqual(["saved"]);
      settings.providers.p.enabled = true;
      expect(configuredFanoutModels(settings as never).map((entry) => entry.modelKey)).toEqual([
        "saved",
      ]);
    });
    it("omits removed executor and embedding models and shares the empty snapshot https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const empty = configuredFanoutModels({ configuredModels: [], providers: {} } as never);
      expect(
        configuredFanoutModels({
          configuredModels: [
            {
              configuredModelId: "legacy",
              providerId: "old",
              info: { id: "agent", displayName: "Old" },
            },
            {
              configuredModelId: "embedding",
              providerId: "p",
              info: { id: "embed", displayName: "Embedding", isEmbedding: true },
            },
          ],
          providers: {
            old: { origin: { kind: "agent", agentType: "claude" } },
            p: { origin: { kind: "byok" } },
          },
        } as never)
      ).toBe(empty);
      expect(Object.isFrozen(empty)).toBe(true);
    });
  });
  describe("resolveAnswererModels()", () => {
    it("returns the selected model keys on the single Pi engine", () => {
      const selected = resolveAnswererModels({
        mentionedModelKeys: ["anthropic/claude", "openai/gpt"],
        availableModels: [
          model({ modelKey: "anthropic/claude" }),
          model({ modelKey: "openai/gpt" }),
        ],
      });

      expect(FANOUT_ENGINE_ID).toBe("pi");
      expect(selected).toEqual(["anthropic/claude", "openai/gpt"]);
    });

    it("dedupes the same model selected twice by an explicit policy", () => {
      const selected = resolveAnswererModels({
        mentionedModelKeys: ["anthropic/claude", "anthropic/claude", "openai/gpt"],
        availableModels: [
          model({ modelKey: "anthropic/claude" }),
          model({ modelKey: "openai/gpt" }),
        ],
      });

      expect(FANOUT_DUPLICATE_MODEL_POLICY).toBe("dedupe");
      expect(selected).toEqual(["anthropic/claude", "openai/gpt"]);

      expectCode(
        () =>
          resolveAnswererModels({
            mentionedModelKeys: ["anthropic/claude", "anthropic/claude"],
            availableModels: [model({ modelKey: "anthropic/claude" })],
          }),
        "FANOUT_MODEL_COUNT"
      );
    });

    it("disables a model without a usable key instead of running it", () => {
      expectCode(
        () =>
          resolveAnswererModels({
            mentionedModelKeys: ["anthropic/claude", "openai/gpt"],
            availableModels: [
              model({ modelKey: "anthropic/claude" }),
              model({ modelKey: "openai/gpt", hasKey: false }),
            ],
          }),
        "FANOUT_MODEL_NO_KEY"
      );

      expect(
        enabledFanoutModels([
          model({ modelKey: "anthropic/claude" }),
          model({ modelKey: "openai/gpt", hasKey: false }),
        ]).map((entry) => entry.modelKey)
      ).toEqual(["anthropic/claude"]);
    });

    it("validates between two and four available models", () => {
      const models = ["a", "b", "c", "d", "e"].map((modelKey) => model({ modelKey }));
      expect(FANOUT_MIN_ANSWERERS).toBe(2);
      expect(FANOUT_MAX_ANSWERERS).toBe(4);

      expectCode(
        () =>
          resolveAnswererModels({
            mentionedModelKeys: ["a"],
            availableModels: models,
          }),
        "FANOUT_MODEL_COUNT"
      );
      expectCode(
        () =>
          resolveAnswererModels({
            mentionedModelKeys: ["a", "b", "c", "d", "e"],
            availableModels: models,
          }),
        "FANOUT_MODEL_COUNT"
      );
      expect(
        resolveAnswererModels({
          mentionedModelKeys: ["a", "b", "c", "d"],
          availableModels: models,
        })
      ).toHaveLength(4);
    });

    it("refuses an unknown model and any engine other than pi", () => {
      expectCode(
        () =>
          resolveAnswererModels({
            mentionedModelKeys: ["anthropic/claude", "missing/model"],
            availableModels: [model({ modelKey: "anthropic/claude" })],
          }),
        "FANOUT_MODEL_UNAVAILABLE"
      );
      expectCode(
        () =>
          resolveAnswererModels({
            mentionedModelKeys: ["anthropic/claude", "codex-cli/default"],
            availableModels: [
              model({ modelKey: "anthropic/claude" }),
              model({ modelKey: "codex-cli/default", engineId: "codex-cli" as never }),
            ],
          }),
        "FANOUT_ENGINE_MISMATCH"
      );
    });

    it("refuses two model keys that share one configuration", () => {
      expectCode(
        () =>
          resolveAnswererModels({
            mentionedModelKeys: ["anthropic/claude", "openai/gpt"],
            availableModels: [
              model({ modelKey: "anthropic/claude", configFingerprint: "same-config" }),
              model({ modelKey: "openai/gpt", configFingerprint: "same-config" }),
            ],
          }),
        "FANOUT_DUPLICATE_CONFIG"
      );
    });

    it("keeps the empty selection empty and reports fan-out only for real multi-model turns", () => {
      expect(resolveAnswererModels({ mentionedModelKeys: [], availableModels: [] })).toBe(
        EMPTY_ANSWERER_MODELS
      );
      expect(isFanoutModels([], "anthropic/claude")).toBe(false);
      expect(isFanoutModels(["anthropic/claude"], "anthropic/claude")).toBe(false);
      expect(isFanoutModels(["anthropic/claude", "openai/gpt"], "anthropic/claude")).toBe(true);
    });
  });
});
