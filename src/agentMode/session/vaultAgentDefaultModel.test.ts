import type { VaultAgentSettings } from "@/settings/model";
import type { BackendDescriptor } from "./types";

const mockGetSettings = jest.fn<VaultAgentSettings, []>();
const mockSetSettings = jest.fn<void, [(cur: VaultAgentSettings) => Partial<VaultAgentSettings>]>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  setSettings: (updater: (cur: VaultAgentSettings) => Partial<VaultAgentSettings>) =>
    mockSetSettings(updater),
}));

import { seedVaultAgentDefaultModel } from "./vaultAgentDefaultModel";

const FLASH_ID = "cm-flash";

function descriptor(id: string, wireBaseId: string | null | undefined): BackendDescriptor {
  return {
    id,
    getWireBaseId: wireBaseId === undefined ? undefined : () => wireBaseId,
  } as unknown as BackendDescriptor;
}

function settingsWith(backends: Record<string, unknown>): VaultAgentSettings {
  return { agentMode: { backends } } as unknown as VaultAgentSettings;
}

function writtenBackends(current: VaultAgentSettings): Record<string, unknown> {
  const updater = mockSetSettings.mock.calls[0][0];
  const patch = updater(current) as { agentMode: { backends: Record<string, unknown> } };
  return patch.agentMode.backends;
}

describe("copilotDefaultModel", () => {
  beforeEach(() => {
    mockSetSettings.mockClear();
  });

  describe("seedVaultAgentDefaultModel()", () => {
    it("makes the model the default for every backend that can route it", () => {
      const current = settingsWith({});
      mockGetSettings.mockReturnValue(current);
      const descriptors = [
        descriptor("opencode", "copilot-plus/copilot-plus-flash"),
        descriptor("pi", "copilot-plus-flash"),
      ];

      expect(seedVaultAgentDefaultModel(descriptors, FLASH_ID)).toEqual(["opencode", "pi"]);
      expect(writtenBackends(current)).toEqual({
        opencode: {
          defaultModel: { baseModelId: "copilot-plus/copilot-plus-flash", effort: null },
        },
        pi: { defaultModel: { baseModelId: "copilot-plus-flash", effort: null } },
      });
    });

    it("skips a backend that cannot route the model and one that does not answer at all", () => {
      const current = settingsWith({});
      mockGetSettings.mockReturnValue(current);
      const descriptors = [
        descriptor("opencode", "copilot-plus/copilot-plus-flash"),
        descriptor("claude", null),
        descriptor("codex", undefined),
      ];

      expect(seedVaultAgentDefaultModel(descriptors, FLASH_ID)).toEqual(["opencode"]);
      expect(Object.keys(writtenBackends(current))).toEqual(["opencode"]);
    });

    it("preserves other settings in a touched slice and other backends' slices", () => {
      const current = settingsWith({
        opencode: {
          binaryPath: "/usr/bin/opencode",
          defaultModel: { baseModelId: "old", effort: "high" },
        },
        claude: { defaultModel: { baseModelId: "claude-sonnet-4-5", effort: null } },
      });
      mockGetSettings.mockReturnValue(current);
      const descriptors = [
        descriptor("opencode", "copilot-plus/copilot-plus-flash"),
        descriptor("claude", null),
      ];

      seedVaultAgentDefaultModel(descriptors, FLASH_ID);

      expect(writtenBackends(current)).toEqual({
        opencode: {
          binaryPath: "/usr/bin/opencode",
          defaultModel: { baseModelId: "copilot-plus/copilot-plus-flash", effort: null },
        },
        claude: { defaultModel: { baseModelId: "claude-sonnet-4-5", effort: null } },
      });
    });

    it("writes nothing when no backend can route the model", () => {
      mockGetSettings.mockReturnValue(settingsWith({}));

      const seeded = seedVaultAgentDefaultModel([descriptor("claude", null)], FLASH_ID);

      expect(seeded).toEqual([]);
      expect(mockSetSettings).not.toHaveBeenCalled();
    });

    it("writes once for all backends so a live session re-applies the default a single time", () => {
      mockGetSettings.mockReturnValue(settingsWith({}));
      const descriptors = [
        descriptor("opencode", "copilot-plus/copilot-plus-flash"),
        descriptor("pi", "copilot-plus-flash"),
      ];

      seedVaultAgentDefaultModel(descriptors, FLASH_ID);

      expect(mockSetSettings).toHaveBeenCalledTimes(1);
    });
  });
});
