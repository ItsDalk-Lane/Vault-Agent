import {
  buildModelEnableGroups,
  collectChatCandidates,
  rowMatches,
  toRow,
  type Candidate,
} from "./configuredModelGrouping";
import type { ConfiguredModel, Provider } from "@/modelManagement";
import { ModelCapability } from "@/constants";

function byokProvider(id: string, displayName: string): Provider {
  return {
    providerId: id,
    providerType: "anthropic",
    displayName,
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
  };
}

function model(configuredModelId: string, providerId: string, infoId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: infoId, displayName: infoId },
    configuredAt: 0,
  };
}

describe("configuredModelGrouping", () => {
  describe("collectChatCandidates()", () => {
    it("hides disabled providers while preserving prior model switches when enabled again https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const provider = { ...byokProvider("disabled", "Disabled"), enabled: false };
      const models = [model("on", "disabled", "on"), model("off", "disabled", "off")];
      const enabled = new Set(["on"]);
      expect(collectChatCandidates(models, { disabled: provider }, enabled)).toEqual([]);
      expect(
        collectChatCandidates(models, { disabled: { ...provider, enabled: true } }, enabled).map(
          (candidate) => candidate.enabled
        )
      ).toEqual([true, false]);
    });

    const byok = byokProvider("byok-1", "Anthropic");
    const providers = { [byok.providerId]: byok };

    it("lists current BYOK chat models with their enabled state", () => {
      const candidates = collectChatCandidates(
        [
          model("m-on", "byok-1", "claude-sonnet-4-5"),
          model("m-off", "byok-1", "claude-haiku-4-5"),
        ],
        providers,
        new Set(["m-on"])
      );
      expect(candidates.map((c) => [c.configuredModel.configuredModelId, c.enabled])).toEqual([
        ["m-on", true],
        ["m-off", false],
      ]);
    });

    it("omits embedding models and models whose provider is missing", () => {
      const embedding: ConfiguredModel = {
        ...model("m-embed", "byok-1", "text-embedding-3-small"),
        info: { id: "text-embedding-3-small", displayName: "Embed", isEmbedding: true },
      };
      const candidates = collectChatCandidates(
        [
          embedding,
          model("m-orphan", "missing-provider", "x"),
          model("m-chat", "byok-1", "claude-sonnet-4-5"),
        ],
        providers,
        new Set()
      );
      expect(candidates.map((c) => c.configuredModel.configuredModelId)).toEqual(["m-chat"]);
    });

    it.each(["agent", "retired"])(
      "excludes a loaded %s provider without rewriting its saved model https://github.com/ItsDalk-Lane/Vault-Agent/issues/2",
      (kind) => {
        const unavailable = {
          ...byokProvider("unavailable", "Unavailable"),
          origin: { kind },
        } as unknown as Provider;
        const models = [
          model("m-current", byok.providerId, "chat"),
          model("m-old", "unavailable", "old"),
        ];
        expect(
          collectChatCandidates(models, { ...providers, unavailable }, new Set(["m-old"])).map(
            (candidate) => candidate.configuredModel.configuredModelId
          )
        ).toEqual(["m-current"]);
        expect(models).toHaveLength(2);
        expect(unavailable.origin).toEqual({ kind });
      }
    );
  });

  describe("toRow()", () => {
    it("never surfaces the wire id as the description (it duplicates the label)", () => {
      const provider = byokProvider("p", "Anthropic");
      const withName: Candidate = {
        configuredModel: {
          configuredModelId: "cm",
          providerId: "p",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      };
      const row = toRow(withName);
      expect(row.label).toBe("Claude Sonnet 4.5");
      expect(row.description).toBeUndefined();
      expect(row.wireId).toBe("claude-sonnet-4-5");

      const sameAsId: Candidate = {
        configuredModel: model("cm2", "p", "raw-id"),
        provider,
        enabled: false,
      };
      expect(toRow(sameAsId).description).toBeUndefined();
    });

    it("prefers the capability blurb over the wire id for the description line", () => {
      const provider = byokProvider("claude", "Anthropic");
      const candidate: Candidate = {
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: {
            id: "default",
            displayName: "Default (recommended)",
            description: "Opus 4.7 with 1M context · Most capable for complex work",
          },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      };
      const row = toRow(candidate);
      expect(row.label).toBe("Default (recommended)");
      expect(row.description).toBe("Opus 4.7 with 1M context · Most capable for complex work");
    });

    it("derives the vision capability from info.modalities (for the row's icon)", () => {
      const provider = byokProvider("claude", "Anthropic");
      const visionRow = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: {
            id: "claude-sonnet-4-5",
            displayName: "Claude Sonnet 4.5",
            modalities: { input: ["text", "image"] },
          },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(visionRow.capabilities).toContain(ModelCapability.VISION);
    });

    it("leaves capabilities undefined for an unknown snapshot, defined for a known one", () => {
      const provider = byokProvider("claude", "Anthropic");
      const unknownRow = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "claude",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(unknownRow.capabilities).toBeUndefined();

      const knownNoVisionRow = toRow({
        configuredModel: {
          configuredModelId: "cm2",
          providerId: "claude",
          info: { id: "text-only", displayName: "Text Only", modalities: { input: ["text"] } },
          configuredAt: 0,
        },
        provider,
        enabled: true,
      });
      expect(knownNoVisionRow.capabilities).toBeDefined();
      expect(knownNoVisionRow.capabilities).not.toContain(ModelCapability.VISION);
    });
  });

  describe("buildModelEnableGroups()", () => {
    it("groups configured models under their providers and retains their enabled state", () => {
      const provider = byokProvider("p", "Anthropic");
      const candidates = collectChatCandidates(
        [model("a", "p", "sonnet"), model("b", "p", "haiku")],
        { p: provider },
        new Set(["a"])
      );
      expect(buildModelEnableGroups(candidates, "")).toEqual([
        expect.objectContaining({
          key: "byok:p",
          label: "Anthropic",
          rows: [
            expect.objectContaining({ id: "a", enabled: true }),
            expect.objectContaining({ id: "b", enabled: false }),
          ],
        }),
      ]);
    });

    it("searches case-insensitively and omits providers without matching models", () => {
      const candidates = collectChatCandidates(
        [model("a", "p", "sonnet"), model("b", "q", "gpt")],
        { p: byokProvider("p", "Anthropic"), q: byokProvider("q", "OpenAI") },
        new Set()
      );
      const groups = buildModelEnableGroups(candidates, " SONNET ");
      expect(groups.map((group) => group.label)).toEqual(["Anthropic"]);
      expect(groups[0].rows.map((row) => row.id)).toEqual(["a"]);
    });
  });

  describe("rowMatches()", () => {
    it("matches a model by its wire id even when the label differs", () => {
      const row = toRow({
        configuredModel: {
          configuredModelId: "cm",
          providerId: "p",
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
          configuredAt: 0,
        },
        provider: byokProvider("p", "Anthropic"),
        enabled: true,
      });
      expect(rowMatches(row, "claude-sonnet-4-5")).toBe(true);
      expect(rowMatches(row, "sonnet")).toBe(true);
      expect(rowMatches(row, "gpt")).toBe(false);
    });
  });
});
