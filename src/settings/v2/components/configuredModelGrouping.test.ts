import {
  opencodeOnlySubGroupLabel,
  partitionCandidates,
  partitionChatCandidates,
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

function agentProvider(
  id: string,
  agentType: "opencode" | "claude" | "codex",
  displayName = id
): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName,
    origin: { kind: "agent", agentType },
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
  describe("partitionCandidates()", () => {
    const byok = byokProvider("byok-1", "Anthropic");
    const ocAgent = agentProvider("oc-agent", "opencode", "opencode");
    const codexAgent = agentProvider("codex-agent", "codex", "Codex");
    const providers = {
      [byok.providerId]: byok,
      [ocAgent.providerId]: ocAgent,
      [codexAgent.providerId]: codexAgent,
    };
    const models = [
      model("m-byok", "byok-1", "claude-sonnet-4-5"),
      model("m-oc", "oc-agent", "opencode/big-pickle"),
      model("m-codex", "codex-agent", "gpt-5"),
    ];

    it("opencode: BYOK rows + opencode agent-origin rows; excludes other agents", () => {
      const { byokPlusCandidates, agentOriginCandidates } = partitionCandidates(
        models,
        providers,
        new Set(),
        "opencode",
        true
      );
      expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-byok",
      ]);
      expect(agentOriginCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-oc",
      ]);
    });

    it("codex: only this agent's agent-origin rows, no BYOK", () => {
      const { byokPlusCandidates, agentOriginCandidates } = partitionCandidates(
        models,
        providers,
        new Set(),
        "codex",
        false
      );
      expect(byokPlusCandidates).toHaveLength(0);
      expect(agentOriginCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-codex",
      ]);
    });

    it("reflects enabled state from the enabled-id set", () => {
      const { agentOriginCandidates } = partitionCandidates(
        models,
        providers,
        new Set(["m-codex"]),
        "codex",
        false
      );
      expect(agentOriginCandidates[0].enabled).toBe(true);
    });

    it("opencode: drops BYOK/Plus providers the routability predicate rejects (dead-toggle guard)", () => {
      const unroutable: Provider = {
        providerId: "byok-google",
        providerType: "google",
        displayName: "Google",
        origin: { kind: "byok" },
        addedAt: 0,
      };
      const withUnroutable = {
        ...providers,
        [unroutable.providerId]: unroutable,
      };
      const allModels = [...models, model("m-google", "byok-google", "gemini-3-flash")];
      const isRoutable = (p: Provider): boolean =>
        p.origin.kind === "byok" ? Boolean(p.origin.catalogProviderId) : true;
      const { byokPlusCandidates } = partitionCandidates(
        allModels,
        withUnroutable,
        new Set(),
        "opencode",
        true,
        isRoutable
      );
      expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-byok",
      ]);
    });

    it("opencode: keeps every BYOK/Plus provider when no routability predicate is given", () => {
      const unroutable: Provider = {
        providerId: "byok-google",
        providerType: "google",
        displayName: "Google",
        origin: { kind: "byok" },
        addedAt: 0,
      };
      const allModels = [...models, model("m-google", "byok-google", "gemini-3-flash")];
      const { byokPlusCandidates } = partitionCandidates(
        allModels,
        { ...providers, [unroutable.providerId]: unroutable },
        new Set(),
        "opencode",
        true
      );
      expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId).sort()).toEqual([
        "m-byok",
        "m-google",
      ]);
    });

    it("skips models whose provider row is missing", () => {
      const orphan = [model("orphan", "missing-provider", "x")];
      const { byokPlusCandidates, agentOriginCandidates } = partitionCandidates(
        orphan,
        providers,
        new Set(),
        "opencode",
        true
      );
      expect(byokPlusCandidates).toHaveLength(0);
      expect(agentOriginCandidates).toHaveLength(0);
    });
  });

  describe("partitionChatCandidates()", () => {
    const agent = agentProvider("codex-agent", "codex", "Codex");
    const byok = byokProvider("byok-1", "Anthropic");
    const providers = { [byok.providerId]: byok, [agent.providerId]: agent };

    it("lists non-agent chat models with their enabled state and no agent-origin rows", () => {
      const { byokPlusCandidates, agentOriginCandidates } = partitionChatCandidates(
        [
          model("m-on", "byok-1", "claude-sonnet-4-5"),
          model("m-off", "byok-1", "claude-haiku-4-5"),
        ],
        providers,
        new Set(["m-on"])
      );
      expect(
        byokPlusCandidates.map((c) => [c.configuredModel.configuredModelId, c.enabled])
      ).toEqual([
        ["m-on", true],
        ["m-off", false],
      ]);
      expect(agentOriginCandidates).toEqual([]);
    });

    it("omits embedding models, agent-origin models, and models whose provider is missing", () => {
      const embedding: ConfiguredModel = {
        ...model("m-embed", "byok-1", "text-embedding-3-small"),
        info: { id: "text-embedding-3-small", displayName: "Embed", isEmbedding: true },
      };
      const { byokPlusCandidates } = partitionChatCandidates(
        [
          embedding,
          model("m-agent", "codex-agent", "gpt-5"),
          model("m-orphan", "missing-provider", "x"),
          model("m-chat", "byok-1", "claude-sonnet-4-5"),
        ],
        providers,
        new Set()
      );
      expect(byokPlusCandidates.map((c) => c.configuredModel.configuredModelId)).toEqual([
        "m-chat",
      ]);
    });
  });

  describe("opencodeOnlySubGroupLabel()", () => {
    const provider = agentProvider("oc-agent", "opencode", "opencode");

    it("derives the label from the wire-id prefix (first /-segment)", () => {
      expect(
        opencodeOnlySubGroupLabel(model("a", "oc-agent", "opencode/big-pickle"), provider)
      ).toBe("opencode");
      expect(
        opencodeOnlySubGroupLabel(model("b", "oc-agent", "openrouter/anthropic/claude"), provider)
      ).toBe("openrouter");
    });

    it("falls back to the provider display name when the id has no prefix", () => {
      expect(opencodeOnlySubGroupLabel(model("c", "oc-agent", "bare-model"), provider)).toBe(
        "opencode"
      );
    });
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
      const provider = agentProvider("claude", "claude", "Claude");
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
      const provider = agentProvider("claude", "claude", "Claude");
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
      const provider = agentProvider("claude", "claude", "Claude");
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

    it("flags opencode Zen models (opencode/ wire id) as free, others not", () => {
      const provider = agentProvider("oc", "opencode", "opencode");
      const zen = toRow({
        configuredModel: model("z", "oc", "opencode/big-pickle"),
        provider,
        enabled: false,
      });
      const lms = toRow({
        configuredModel: model("l", "oc", "lmstudio/gpt-oss-20b"),
        provider,
        enabled: false,
      });
      expect(zen.isFree).toBe(true);
      expect(lms.isFree).toBe(false);
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
