import { dehydrateDeviceProfile, hydrateDeviceProfile } from "@/settings/deviceProfiles";
import type { VaultAgentSettings } from "@/settings/model";

type AgentMode = VaultAgentSettings["agentMode"];

function makeAgentMode(partial: Partial<AgentMode> = {}): AgentMode {
  return {
    byok: {},
    activeBackend: "pi",
    backends: {},
    debugFullFrames: false,
    offerFeedbackCards: true,
    notificationSound: false,
    notificationSoundId: "piano",
    welcomeDismissed: false,
    skills: { folder: "vault-agent/skills" },
    ...partial,
  };
}

function makeSettings(agentMode: AgentMode, settingsVersion = 6): VaultAgentSettings {
  return { settingsVersion, agentMode } as unknown as VaultAgentSettings;
}

const DEVICE_A = "device-a";

// Device-specific fields are only environment overrides now; the managed-binary paths and CLI
// locations belonged to the removed legacy execution chains.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
describe("deviceProfiles", () => {
  describe("dehydrateDeviceProfile()", () => {
    it("moves environment overrides into deviceProfiles[deviceId] and strips them", () => {
      const settings = makeSettings(
        makeAgentMode({
          backends: {
            codex: { envOverrides: { FOO: "1" } },
            opencode: { envOverrides: { BAR: "2" } },
            claude: { envOverrides: { BAZ: "3" } },
          },
        })
      );

      const out = dehydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.backends.codex?.envOverrides).toBeUndefined();
      expect(out.agentMode.backends.opencode?.envOverrides).toBeUndefined();
      expect(out.agentMode.backends.claude?.envOverrides).toBeUndefined();
      expect(out.agentMode.deviceProfiles?.[DEVICE_A]).toEqual({
        codex: { envOverrides: { FOO: "1" } },
        opencode: { envOverrides: { BAR: "2" } },
        claude: { envOverrides: { BAZ: "3" } },
      });
    });

    it("keeps synced prefs like defaultModel in the flat backends slice", () => {
      const settings = makeSettings(
        makeAgentMode({
          backends: {
            codex: { defaultModel: { baseModelId: "gpt-5", effort: null } },
            claude: { enableThinking: true },
          },
        })
      );

      const out = dehydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.backends.codex?.defaultModel).toEqual({
        baseModelId: "gpt-5",
        effort: null,
      });
      expect(out.agentMode.backends.claude?.enableThinking).toBe(true);
    });

    it("drops the per-device profile when nothing device-specific remains", () => {
      const settings = makeSettings(makeAgentMode());

      const out = dehydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.deviceProfiles).toBeUndefined();
    });
  });

  describe("hydrateDeviceProfile()", () => {
    it("restores this device's environment overrides", () => {
      const settings = makeSettings(
        makeAgentMode({
          deviceProfiles: {
            [DEVICE_A]: {
              codex: { envOverrides: { FOO: "1" } },
              opencode: { envOverrides: { BAR: "2" } },
              claude: { envOverrides: { BAZ: "3" } },
            },
          },
        })
      );

      const out = hydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.backends.codex?.envOverrides).toEqual({ FOO: "1" });
      expect(out.agentMode.backends.opencode?.envOverrides).toEqual({ BAR: "2" });
      expect(out.agentMode.backends.claude?.envOverrides).toEqual({ BAZ: "3" });
    });

    it("round-trips through dehydrate and hydrate", () => {
      const settings = makeSettings(
        makeAgentMode({ backends: { codex: { envOverrides: { A: "1" } } } })
      );

      const dehydrated = dehydrateDeviceProfile(settings, DEVICE_A);
      const hydrated = hydrateDeviceProfile(dehydrated, DEVICE_A);

      expect(hydrated.agentMode.backends.codex?.envOverrides).toEqual({ A: "1" });
    });
  });
});
