import type { ModelConnectionTestInput } from "@/types/modelConnectionTest";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockVerifyCredentials = jest.fn<Promise<VerificationResult>, [string, unknown]>();
const mockSetupProvider = jest
  .fn<Promise<{ providerId: string; configuredModelIds: string[] }>, [unknown]>()
  .mockResolvedValue({ providerId: "p-new", configuredModelIds: ["cm1"] });
const mockSetApiKey = jest.fn().mockResolvedValue(undefined);
const mockClearApiKey = jest.fn().mockResolvedValue(undefined);
const mockGetApiKey = jest.fn().mockResolvedValue("existing-key");
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockBulkSet = jest.fn().mockResolvedValue([]);
const mockEnableModel = jest.fn().mockResolvedValue(undefined);
const mockRemoveRefs = jest.fn().mockResolvedValue(undefined);
const mockGetProvider = jest.fn();
const mockSaveProviderDraft = jest
  .fn()
  .mockResolvedValue({ providerId: "new", configuredModelIds: [] });
const mockResolveDeclared = jest.fn();
const mockTestModelConnection = jest
  .fn<Promise<void>, [ModelConnectionTestInput]>()
  .mockResolvedValue(undefined);

jest.mock("@/modelManagement/ui/ModelManagementContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useModelManagement` hook; the name must match the export
  useModelManagement: () => ({
    adapters: { verifyCredentials: mockVerifyCredentials },
    testModelConnection: mockTestModelConnection,
    setup: { byok: { setupProvider: mockSetupProvider, saveProviderDraft: mockSaveProviderDraft } },
    resolveDeclaredModelCapabilities: mockResolveDeclared,
    providerRegistry: {
      setApiKey: mockSetApiKey,
      clearApiKey: mockClearApiKey,
      getApiKey: mockGetApiKey,
      update: mockUpdate,
    },
    configuredModelRegistry: { bulkSet: mockBulkSet },
    backendConfigRegistry: { enableModel: mockEnableModel, removeRefs: mockRemoveRefs },
    coordinator: { removeProvider: jest.fn() },
    catalogService: {
      getProvider: mockGetProvider,
      ensureLoaded: jest.fn().mockResolvedValue(undefined),
      onChange: jest.fn().mockReturnValue(() => {}),
    },
  }),
}));
// eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `useApp` hook; the name must match the export
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/modelManagement/state/atoms", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return {
    byokProvidersAtom: jotai.atom([
      {
        providerId: "p1",
        providerType: "anthropic",
        displayName: "Anthropic",
        baseUrl: "https://api.anthropic.com",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
        addedAt: 0,
      },
      {
        providerId: "p-custom",
        providerType: "openai-compatible",
        displayName: "Custom",
        baseUrl: "https://proxy.example/v1",
        enableCors: true,
        origin: { kind: "byok" },
        addedAt: 0,
      },
    ]),
    backendsAtom: jotai.atom({ pi: { enabledModels: ["cm1", "cm-custom"] } }),
    configuredModelsAtom: jotai.atom([
      {
        configuredModelId: "cm1",
        providerId: "p1",
        info: {
          id: "claude-sonnet",
          displayName: "Claude Sonnet 4.5",
          limits: { context: 200000 },
        },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm2",
        providerId: "p1",
        info: { id: "claude-opus", displayName: "Claude Opus 4.5" },
        configuredAt: 0,
      },
      {
        configuredModelId: "cm-custom",
        providerId: "p-custom",
        info: { id: "work-model", displayName: "Work model" },
        configuredAt: 0,
      },
    ]),
  };
});
jest.mock("@/settings/model", () => {
  const jotai = jest.requireActual<typeof import("jotai")>("jotai");
  return { settingsStore: jotai.createStore() };
});
jest.mock("@/components/ui/password-input", () => ({
  PasswordInput: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <input data-testid="api-key" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));
const mockListProviderModels = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("@/modelManagement/providers/adapters/listProviderModels", () => ({
  listProviderModels: (...args: unknown[]) => mockListProviderModels(...args),
}));

import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import { CUSTOM_OPENAI_DEFINITION } from "@/modelManagement/catalog/builtinDefinitions";
import { ConfigureProviderForm } from "./ConfigureProviderDialog";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";
const source: ProviderDefinition = {
  id: "anthropic",
  displayName: "Anthropic",
  providerType: "anthropic",
  defaultBaseUrl: "https://api.anthropic.com",
  requiresApiKey: true,
  modelInputHint: "",
  catalogProviderId: "anthropic",
};
const local: ProviderDefinition = {
  id: "local",
  displayName: "Local",
  providerType: "openai-compatible",
  defaultBaseUrl: "http://localhost:11434/v1",
  requiresApiKey: false,
  modelInputHint: "",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetApiKey.mockResolvedValue("existing-key");
  mockVerifyCredentials.mockResolvedValue({ ok: true, checkedAt: 1 });
  mockSaveProviderDraft.mockResolvedValue({ providerId: "new", configuredModelIds: [] });
  mockListProviderModels.mockResolvedValue({ ok: true, modelIds: [] });
  mockGetProvider.mockReturnValue(undefined);
  mockResolveDeclared.mockReturnValue(undefined);
});
function manualAdd(id: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add model" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Model ID" }), { target: { value: id } });
}
async function fetchAndAdd(id: string) {
  fireEvent.click(screen.getByRole("button", { name: "Get model list" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: id }));
  fireEvent.click(screen.getByRole("button", { name: "Add selected (1)" }));
}

describe("ConfigureProviderDialog", () => {
  describe("ConfigureProviderForm()", () => {
    it(`tests the selected model with unsaved endpoint and key without saving the provider (${ISSUE})`, async () => {
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      await screen.findByRole("button", { name: "Check claude-sonnet" });
      fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
        target: { value: "https://draft.example/messages" },
      });
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "unsaved-key-fixture" } });
      fireEvent.click(screen.getByRole("button", { name: "Check claude-sonnet" }));
      await waitFor(() => expect(mockTestModelConnection).toHaveBeenCalledTimes(1));
      const sent = mockTestModelConnection.mock.calls[0][0];
      expect(sent).toMatchObject({
        provider: {
          providerType: "anthropic",
          baseUrl: "https://draft.example/messages",
          origin: { kind: "byok", catalogProviderId: "anthropic" },
        },
        model: { id: "claude-sonnet" },
        apiKey: "unsaved-key-fixture",
      });
      expect(sent.signal).toBeInstanceOf(AbortSignal);
      expect(mockListProviderModels).not.toHaveBeenCalled();
      expect(mockSaveProviderDraft).not.toHaveBeenCalled();
    });
    it.each(["OpenAI Responses", "Anthropic Messages"])(
      `keeps a third-party default on its original host when selecting %s (${ISSUE})`,
      async (format) => {
        render(
          <ConfigureProviderForm
            state={{
              mode: "new",
              source: {
                ...local,
                id: "groq",
                displayName: "Groq",
                defaultBaseUrl: "https://api.groq.com/openai/v1",
              },
            }}
            onClose={jest.fn()}
          />
        );
        fireEvent.keyDown(screen.getByRole("button", { name: "API format" }), { key: "Enter" });
        fireEvent.click(await screen.findByRole("menuitem", { name: format }));
        expect(screen.getByRole("textbox", { name: "Base URL" })).toHaveProperty(
          "value",
          "https://api.groq.com/openai/v1"
        );
      }
    );
    it(`changes a native protocol default when switching to another native API format (${ISSUE})`, async () => {
      render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
      fireEvent.keyDown(screen.getByRole("button", { name: "API format" }), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Google Generative AI" }));
      expect(screen.getByRole("textbox", { name: "Base URL" })).toHaveProperty(
        "value",
        "https://generativelanguage.googleapis.com/v1beta"
      );
    });
    it(`does not contact the provider until the model list is requested (${ISSUE})`, () => {
      render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
      expect(mockListProviderModels).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "Base URL" })).toHaveProperty(
        "value",
        "https://api.anthropic.com"
      );
    });
    it(`requires a custom endpoint and preserves manually entered endpoints (${ISSUE})`, async () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "new", source: CUSTOM_OPENAI_DEFINITION }}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
      fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
        target: { value: "https://custom.example/v1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(mockSaveProviderDraft).toHaveBeenCalledWith(
          expect.objectContaining({ baseUrl: "https://custom.example/v1", apiKey: "", models: [] })
        )
      );
      expect(mockVerifyCredentials).not.toHaveBeenCalled();
    });
    it(`fetches models using the draft endpoint and saved key without rewriting the key (${ISSUE})`, async () => {
      mockGetApiKey.mockResolvedValue("saved-secret");
      mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["work-model"] });
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
        />
      );
      await screen.findByDisplayValue("saved-secret");
      fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
        target: { value: "https://new.example/v1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Get model list" }));
      await screen.findByRole("checkbox", { name: "work-model" });
      expect(mockListProviderModels).toHaveBeenCalledWith(
        "openai-compatible",
        "https://new.example/v1",
        expect.objectContaining({ apiKey: "saved-secret" })
      );
      expect(mockSetApiKey).not.toHaveBeenCalled();
    });
    it(`merges real list results with catalog and Pi declarations before adding model cards (${ISSUE})`, async () => {
      mockGetProvider.mockReturnValue({
        models: {
          a: {
            id: "a",
            displayName: "A",
            limits: { context: 200000 },
            modalities: { input: ["text", "image"] },
          },
        },
      });
      mockResolveDeclared.mockReturnValue({
        capabilities: { structuredOutput: true },
        reasoningEfforts: ["low", "high"],
      });
      mockListProviderModels.mockResolvedValue({ ok: true, modelIds: ["a"] });
      render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "secret" } });
      await fetchAndAdd("a");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(mockSaveProviderDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            catalogProviderId: "anthropic",
            models: [
              expect.objectContaining({
                enabled: true,
                info: expect.objectContaining({
                  id: "a",
                  limits: expect.objectContaining({ context: 200000 }) as unknown,
                  capabilities: {
                    structuredOutput: true,
                    nativeWebSearch: false,
                    midConversationSystemMessages: false,
                  },
                  reasoningEfforts: ["low", "high"],
                }) as unknown,
              }),
            ],
          })
        )
      );
    });
    it(`saves manual IDs with the same visible name without needing a catalog match (${ISSUE})`, async () => {
      render(<ConfigureProviderForm state={{ mode: "new", source: local }} onClose={jest.fn()} />);
      manualAdd("llama3.2");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(mockSaveProviderDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            requiresApiKey: false,
            models: [
              expect.objectContaining({
                info: expect.objectContaining({
                  id: "llama3.2",
                  displayName: "llama3.2",
                }) as unknown,
              }),
            ],
          })
        )
      );
    });
    it(`keeps model visibility independent and saves hidden configured models instead of deleting them (${ISSUE})`, async () => {
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      expect(
        (
          await screen.findByRole("switch", { name: "Show claude-sonnet in model pickers" })
        ).getAttribute("aria-checked")
      ).toBe("true");
      expect(
        screen
          .getByRole("switch", { name: "Show claude-opus in model pickers" })
          .getAttribute("aria-checked")
      ).toBe("false");
      fireEvent.click(screen.getByRole("switch", { name: "Show claude-sonnet in model pickers" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(mockSaveProviderDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            models: [
              expect.objectContaining({
                enabled: false,
                info: expect.objectContaining({ id: "claude-sonnet" }) as unknown,
              }),
              expect.objectContaining({
                enabled: false,
                info: expect.objectContaining({ id: "claude-opus" }) as unknown,
              }),
            ],
          })
        )
      );
    });
    it(`keeps credentials and provider enablement as a draft when canceled (${ISSUE})`, async () => {
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p-custom" }} onClose={onClose} />
      );
      await screen.findByDisplayValue("existing-key");
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      fireEvent.click(screen.getByRole("switch", { name: "Enable this provider" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalled();
      expect(mockSaveProviderDraft).not.toHaveBeenCalled();
      expect(mockClearApiKey).not.toHaveBeenCalled();
    });
    it(`blocks Save after clearing a required API key (${ISSUE})`, async () => {
      render(
        <ConfigureProviderForm state={{ mode: "edit", providerId: "p1" }} onClose={jest.fn()} />
      );
      fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    });
    it(`does not overwrite a saved key when keychain lookup fails (${ISSUE})`, async () => {
      mockGetApiKey.mockRejectedValueOnce(new Error("locked"));
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
        />
      );
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(mockSaveProviderDraft).not.toHaveBeenCalled();
    });
    it(`shows no editable form for a missing provider and performs no model request (${ISSUE})`, () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "missing" }}
          onClose={jest.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(mockListProviderModels).not.toHaveBeenCalled();
    });
    it(`rejects an invalid key on Save and reports the real verification error (${ISSUE})`, async () => {
      mockVerifyCredentials.mockResolvedValue({
        ok: false,
        code: "invalid_api_key",
        message: "Authentication failed",
        checkedAt: 1,
      });
      render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "bad-key" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        "Authentication failed"
      );
      expect(mockSaveProviderDraft).not.toHaveBeenCalled();
    });
    it(`allows saving when verification is inconclusive due to network failure (${ISSUE})`, async () => {
      mockVerifyCredentials.mockResolvedValue({
        ok: false,
        code: "network",
        message: "offline",
        checkedAt: 1,
      });
      render(<ConfigureProviderForm state={{ mode: "new", source }} onClose={jest.fn()} />);
      fireEvent.change(screen.getByTestId("api-key"), { target: { value: "secret" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockSaveProviderDraft).toHaveBeenCalled());
    });
    it(`does not reverify an unchanged saved key and only reports success after persistence (${ISSUE})`, async () => {
      let finish!: () => void;
      mockSaveProviderDraft.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
      const onSaved = jest.fn();
      const onClose = jest.fn();
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={onClose}
          onSaved={onSaved}
        />
      );
      await screen.findByDisplayValue("existing-key");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockSaveProviderDraft).toHaveBeenCalled());
      expect(mockVerifyCredentials).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      act(() => finish());
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    it(`verifies changed credentials against the draft endpoint before saving (${ISSUE})`, async () => {
      render(
        <ConfigureProviderForm
          state={{ mode: "edit", providerId: "p-custom" }}
          onClose={jest.fn()}
        />
      );
      fireEvent.change(await screen.findByTestId("api-key"), { target: { value: "new-key" } });
      fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
        target: { value: "https://new.example/v1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(mockVerifyCredentials).toHaveBeenCalledWith(
          "openai-compatible",
          expect.objectContaining({
            apiKey: "new-key",
            provider: expect.objectContaining({ baseUrl: "https://new.example/v1" }) as unknown,
          })
        )
      );
    });
  });
});
