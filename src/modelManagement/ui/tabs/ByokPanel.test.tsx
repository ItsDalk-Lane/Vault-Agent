import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { PrimitiveAtom } from "jotai";
import type { Provider } from "@/modelManagement/types/persisted";
import { settingsStore } from "@/settings/model";
import { byokProvidersAtom, configuredModelsAtom } from "@/modelManagement/state/atoms";

const mockGetAllProviders = jest.fn().mockReturnValue([]);
const mockRemoveProvider = jest.fn().mockResolvedValue(undefined);
const mockAddProviderOpen = jest.fn();
const mockConfigureOpen = jest.fn();

jest.mock("@/modelManagement/ui/ModelManagementContext", () => {
  const api = {
    catalogService: { getAllProviders: mockGetAllProviders },
    coordinator: { removeProvider: mockRemoveProvider },
  };
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
  return { useModelManagement: () => api };
});
// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/modelManagement/state/atoms", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  const byokProviders = jotai.atom([
    {
      providerId: "p1",
      providerType: "anthropic",
      displayName: "Anthropic",
      origin: { kind: "byok", catalogProviderId: "anthropic" },
      addedAt: 0,
    },
    {
      providerId: "p2",
      providerType: "openai-compatible",
      displayName: "Local",
      origin: { kind: "byok" },
      addedAt: 0,
      requiresApiKey: false,
    },
  ]);
  return {
    byokProvidersAtom: byokProviders,
    configuredModelsAtom: jotai.atom([
      {
        configuredModelId: "m1",
        providerId: "p1",
        info: { id: "claude", displayName: "Claude Sonnet 4.5", limits: { context: 200000 } },
        configuredAt: 0,
      },
    ]),
  };
});
jest.mock("@/settings/model", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return {
    settingsStore: jotai.createStore(),
  };
});
jest.mock("@/modelManagement/ui/dialogs/ConfigureProviderDialog", () => ({
  ConfigureProviderModal: jest.fn().mockImplementation(() => ({ open: mockConfigureOpen })),
}));
jest.mock("@/modelManagement/ui/dialogs/AddProviderDialog", () => ({
  AddProviderModal: jest.fn().mockImplementation(() => ({ open: mockAddProviderOpen })),
}));

import { ByokPanel } from "./ByokPanel";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

describe("ByokPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  describe("ByokPanel()", () => {
    it("renders configured providers and their models after the catalog loads", async () => {
      render(<ByokPanel />);
      const providerCard = await screen.findByText("Anthropic");
      expect(providerCard).toBeTruthy();

      fireEvent.click(providerCard);
      expect(await screen.findByText("Claude Sonnet 4.5")).toBeTruthy();
    });

    it("hides disabled provider models while keeping its editable provider row and restores models on re-enable (https://github.com/ItsDalk-Lane/Vault-Agent/issues/2)", async () => {
      const atom = byokProvidersAtom as PrimitiveAtom<readonly Provider[]>;
      const originalProviders = settingsStore.get(atom);
      const originalModels = settingsStore.get(configuredModelsAtom);
      const view = render(<ByokPanel />);
      fireEvent.click(screen.getByText("Anthropic"));
      expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();
      try {
        act(() =>
          settingsStore.set(
            atom,
            originalProviders.map((provider) =>
              provider.providerId === "p1" ? { ...provider, enabled: false } : provider
            )
          )
        );
        expect(screen.queryByText("Claude Sonnet 4.5")).toBeNull();
        expect(screen.getByText("Anthropic")).toBeTruthy();
        expect(settingsStore.get(configuredModelsAtom)).toBe(originalModels);
        act(() => settingsStore.set(atom, originalProviders));
        expect(screen.getByText("Claude Sonnet 4.5")).toBeTruthy();
      } finally {
        view.unmount();
        settingsStore.set(atom, originalProviders);
      }
    });

    it("opens the Add Provider modal from the add button", async () => {
      render(<ByokPanel />);
      await screen.findByText("Anthropic");
      fireEvent.click(screen.getByRole("button", { name: /Add a provider/i }));
      expect(mockAddProviderOpen).toHaveBeenCalled();
    });
    it("opens without provider verification or a misleading success badge https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      render(<ByokPanel />);
      expect(screen.getByText("Anthropic")).toBeTruthy();
      expect(screen.queryByText("Verified")).toBeNull();
      expect(screen.queryByText("Checking…")).toBeNull();
    });
  });
});
