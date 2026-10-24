import type { VaultAgentSettings } from "@/settings/model";
import {
  backendDisplayOrder,
  backendRegistry,
  CREATABLE_BACKEND_IDS,
  creatableBackendDescriptors,
  getActiveBackendDescriptor,
  listBackendDescriptors,
  RECOMMENDED_BACKEND_ID,
} from "./registry";
import { PiBackendDescriptor } from "./pi/descriptor";

jest.mock("@/components/modals/ConfirmModal", () => ({ ConfirmModal: class {} }));
jest.mock("@/components/ui/setting-item", () => ({ SettingItem: () => null }));
jest.mock("@/components/ui/button", () => ({ Button: () => null }));
jest.mock("@/components/ui/input", () => ({ Input: () => null }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("obsidian", () => ({
  Modal: class {},
  Notice: class {},
  Platform: { isMobile: false },
}));

describe("registry", () => {
  const baseSettings = (activeBackend?: string, enableSelfHostMode = false): VaultAgentSettings =>
    ({
      enableSelfHostMode,
      agentMode: {
        enabled: true,
        byok: {},
        activeBackend: activeBackend ?? "pi",
        backends: { pi: {} },
      },
    }) as unknown as VaultAgentSettings;

  describe("getActiveBackendDescriptor()", () => {
    it("returns the Pi descriptor when no backend was stored yet", () => {
      const settings = {
        ...baseSettings(),
        agentMode: { ...baseSettings().agentMode, activeBackend: undefined },
      } as unknown as VaultAgentSettings;

      expect(getActiveBackendDescriptor(settings)).toBe(PiBackendDescriptor);
    });

    it("uses only Pi for current and unknown engine selections https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      for (const id of ["pi", "unknown-engine"])
        expect(getActiveBackendDescriptor(baseSettings(id, true))).toBe(PiBackendDescriptor);
      expect(Object.keys(backendRegistry)).toEqual(["pi"]);
    });

    it("falls back to Pi when an unknown backend is selected so no CLI gate appears", () => {
      expect(getActiveBackendDescriptor(baseSettings("nonexistent"))).toBe(PiBackendDescriptor);
      expect(getActiveBackendDescriptor(baseSettings("nonexistent", true))).toBe(
        PiBackendDescriptor
      );
    });
  });

  describe("listBackendDescriptors()", () => {
    it("registers only the bundled engine for model discovery and startup https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(listBackendDescriptors()).toEqual([PiBackendDescriptor]);
      expect(Object.keys(backendRegistry)).toEqual(["pi"]);
      expect(listBackendDescriptors()).toBe(listBackendDescriptors());
    });
  });

  describe("backendDisplayOrder()", () => {
    it("offers only Pi for a new session", () => {
      expect(backendDisplayOrder()).toEqual([PiBackendDescriptor]);
      expect(creatableBackendDescriptors().map((descriptor) => descriptor.id)).toEqual(["pi"]);
      expect(CREATABLE_BACKEND_IDS).toEqual(["pi"]);
    });

    it("returns a stable reference across calls", () => {
      expect(backendDisplayOrder()).toBe(backendDisplayOrder());
    });
  });

  describe("creatableBackendDescriptors()", () => {
    it("never asks for a CLI install or a login before entering chat", () => {
      const descriptors = creatableBackendDescriptors();
      expect(descriptors).toHaveLength(1);
      expect(descriptors.every((descriptor) => descriptor.id === "pi")).toBe(true);
      expect(descriptors.some((descriptor) => "auth" in descriptor)).toBe(false);
    });

    it("returns the stable current engine list", () => {
      expect(creatableBackendDescriptors()).toBe(creatableBackendDescriptors());
    });
  });

  describe("RECOMMENDED_BACKEND_ID", () => {
    it("names the single creatable engine", () => {
      expect(RECOMMENDED_BACKEND_ID).toBe("pi");
      expect(backendRegistry[RECOMMENDED_BACKEND_ID]).toBe(PiBackendDescriptor);
    });
  });
});
