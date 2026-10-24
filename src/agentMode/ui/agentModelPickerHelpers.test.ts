import {
  buildAgentModelPicker,
  handlePickerSwitchError,
  resolveEffortOptions,
} from "./agentModelPickerHelpers";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendDescriptor, EnabledModelEntry, ModelEntry } from "@/agentMode/session/types";
import type { VaultAgentSettings } from "@/settings/model";
import { getModelKeyFromModel } from "@/settings/model";
import { Notice } from "obsidian";
import { logError } from "@/logger";

jest.mock("@/logger", () => ({ logError: jest.fn() }));

const configured: EnabledModelEntry = {
  baseModelId: "saved-local",
  name: "Local model",
  credentialState: "ok",
  effortOptions: [
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
  ],
};
const offered: ModelEntry = {
  baseModelId: "saved-local",
  name: "Local model",
  provider: null,
  effortOptions: [],
};

function setup() {
  const descriptor = {
    id: "pi",
    displayName: "Vault Agent",
    getEnabledModelEntries: jest.fn(() => [configured]),
  } as unknown as BackendDescriptor;
  const session = {
    backendId: "pi",
    getStatus: () => "idle",
    isHistoricalOnly: () => false,
    getState: () => ({
      model: {
        current: { baseModelId: "saved-local", effort: "low" },
        availableModels: [offered],
        apply: { kind: "setModel" },
      },
      mode: null,
    }),
  } as unknown as AgentSession;
  const manager = {
    getActiveSession: jest.fn(() => session as AgentSession | null),
    getActiveChatUIState: jest.fn(() => ({
      canSwitchModel: (): boolean => true,
      canSwitchEffort: (): boolean => true,
    })),
    getCachedModelCatalog: jest.fn((): { availableModels: ModelEntry[] | null } | null => ({
      availableModels: [offered],
    })),
    getPreloadStatus: jest.fn(() => "ready"),
    getDefaultSelection: jest.fn(() => ({ baseModelId: "saved-local", effort: "high" })),
    createSession: jest.fn().mockResolvedValue(undefined),
    applySelection: jest.fn().mockResolvedValue(undefined),
  };
  const args = {
    manager: manager as unknown as AgentSessionManager,
    descriptor,
    settings: {} as VaultAgentSettings,
  };
  return { args, manager, descriptor, session };
}

function key(picker: NonNullable<ReturnType<typeof buildAgentModelPicker>>, index = 0) {
  return getModelKeyFromModel(picker.models[index]);
}

describe("agentModelPickerHelpers", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("handlePickerSwitchError()", () => {
    it("explains unsupported changes without reporting them as an engine crash", () => {
      handlePickerSwitchError(new MethodUnsupportedError("setModel"), "model");
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("support runtime model switching")
      );
      expect(logError).not.toHaveBeenCalled();
    });

    it("reports a failed mode change while preserving the actual error", () => {
      const error = new Error("unavailable");
      handlePickerSwitchError(error, "mode");
      expect(logError).toHaveBeenCalledWith("[AgentMode] mode apply failed", error);
      expect(Notice).toHaveBeenCalled();
    });
  });

  describe("resolveEffortOptions()", () => {
    it("uses current declared reasoning levels before older model caches https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { args } = setup();
      expect(
        resolveEffortOptions(args.manager, "pi", "saved-local", [
          {
            ...configured,
            effortOptions: [
              { value: "high", label: "High" },
              { value: "low", label: "Low" },
            ],
          },
        ]).map((option) => option.value)
      ).toEqual(["low", "high"]);
      const empty = resolveEffortOptions(args.manager, "pi", "saved-local", [
        { ...configured, effortOptions: [] },
      ]);
      expect(empty).toHaveLength(0);
      expect(
        resolveEffortOptions(args.manager, "pi", "saved-local", [
          { ...configured, effortOptions: [] },
        ])
      ).toBe(empty);
    });

    it("uses the current model catalog and leaves unsupported reasoning empty", () => {
      const { args, manager } = setup();
      manager.getCachedModelCatalog.mockReturnValue({
        availableModels: [{ ...offered, effortOptions: [{ value: "high", label: "High" }] }],
      });
      expect(
        resolveEffortOptions(args.manager, "pi", "saved-local").map((option) => option.value)
      ).toEqual(["high"]);
      manager.getCachedModelCatalog.mockReturnValue(null);
      expect(
        resolveEffortOptions(args.manager, "pi", "saved-local").map((option) => option.value)
      ).toEqual([]);
      expect(resolveEffortOptions(args.manager, "pi", "unknown")).toEqual([]);
    });
  });

  describe("buildAgentModelPicker()", () => {
    it("offers only configured models from the built-in engine without legacy setup state https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { args, manager } = setup();
      manager.getCachedModelCatalog.mockReturnValue({
        availableModels: [offered, { ...offered, baseModelId: "not-enabled", name: "Unselected" }],
      });
      const picker = buildAgentModelPicker(args)!;
      expect(
        picker.models.map((model) => [model.displayName, model._group, model._backendId])
      ).toEqual([["Local model", "Vault Agent", "pi"]]);
      expect(picker.value).toBe(key(picker));
      expect(picker.effort?.options.map((option) => option.value)).toEqual(["low", "high"]);
    });

    it("does not expose controls for a missing manager or a read-only historical conversation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { args, manager, session } = setup();
      expect(buildAgentModelPicker({ ...args, manager: null })).toBeNull();
      manager.getActiveSession.mockReturnValue({ ...session, backendId: "claude" } as AgentSession);
      expect(buildAgentModelPicker(args)).toBeNull();
      manager.getActiveSession.mockReturnValue({
        ...session,
        isHistoricalOnly: () => true,
      } as AgentSession);
      expect(buildAgentModelPicker(args)).toBeNull();
      expect(manager.createSession).not.toHaveBeenCalled();
    });

    it("keeps missing credentials and unavailable configured models disabled https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { args, descriptor, manager } = setup();
      jest.mocked(descriptor.getEnabledModelEntries!).mockReturnValue([
        { ...configured, credentialState: "missing_key" },
        { ...configured, baseModelId: "unoffered", name: "Not available" },
      ]);
      const picker = buildAgentModelPicker(args)!;
      expect(picker.models.map((entry) => Boolean(entry._disabledReason))).toEqual([true, true]);
      picker.onChange(key(picker));
      picker.commitSelection?.(key(picker, 1), "high");
      expect(manager.applySelection).not.toHaveBeenCalled();
    });

    it("preserves configured names, model capabilities and provider warnings", () => {
      const { args, descriptor } = setup();
      jest.mocked(descriptor.getEnabledModelEntries!).mockReturnValue([
        {
          ...configured,
          label: "My local model",
          description: "Private",
          needsSelfHostWarning: true,
        },
      ]);
      const picker = buildAgentModelPicker(args)!;
      expect(picker.models[0]).toMatchObject({
        displayName: "My local model",
        _subtitle: "Private",
        _needsSelfHostWarning: true,
      });
    });

    it("shows loading while discovery or session startup is pending", () => {
      const { args, manager, session } = setup();
      manager.getCachedModelCatalog.mockReturnValue(null);
      manager.getPreloadStatus.mockReturnValue("pending");
      const pending = buildAgentModelPicker(args)!;
      expect(pending.models[0].name).toBe("__preload_pending__");
      expect(pending.models[0]._disabledReason).toBeTruthy();
      manager.getPreloadStatus.mockReturnValue("ready");
      manager.getActiveSession.mockReturnValue({
        ...session,
        getStatus: () => "starting",
      } as AgentSession);
      const starting = buildAgentModelPicker(args)!;
      expect(starting.value).toBe(key(starting));
      expect(starting.models[0].name).toBe("__preload_pending__");
    });

    it("uses saved models when discovery failed and shows an error only when none are available", () => {
      const { args, manager, descriptor } = setup();
      manager.getCachedModelCatalog.mockReturnValue(null);
      manager.getPreloadStatus.mockReturnValue("error");
      expect(buildAgentModelPicker(args)!.models[0]._disabledReason).toBeUndefined();
      jest.mocked(descriptor.getEnabledModelEntries!).mockReturnValue([]);
      expect(buildAgentModelPicker(args)!.models[0].name).toBe("__preload_error__");
      manager.getPreloadStatus.mockReturnValue("absent");
      expect(buildAgentModelPicker(args)!.models).toEqual([]);
    });

    it("changes the active model or combined reasoning selection without replacing the conversation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { args, manager } = setup();
      const picker = buildAgentModelPicker(args)!;
      picker.onChange(key(picker));
      expect(manager.applySelection).toHaveBeenLastCalledWith(
        { baseModelId: "saved-local" },
        { expectBackendId: "pi" }
      );
      picker.commitSelection?.(key(picker), "high");
      expect(manager.applySelection).toHaveBeenLastCalledWith(
        { baseModelId: "saved-local", effort: "high" },
        { expectBackendId: "pi" }
      );
      picker.effort?.onChange("high");
      expect(manager.applySelection).toHaveBeenLastCalledWith(
        { effort: "high" },
        { expectBackendId: "pi" }
      );
      expect(manager.createSession).not.toHaveBeenCalled();
    });

    it("creates a new built-in conversation only when no conversation exists https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { args, manager } = setup();
      manager.getActiveSession.mockReturnValue(null);
      const picker = buildAgentModelPicker(args)!;
      picker.onChange(key(picker));
      expect(manager.createSession).toHaveBeenCalledWith("pi", undefined, {
        baseModelId: "saved-local",
        effort: "high",
      });
      picker.commitSelection?.(key(picker), null);
      expect(manager.createSession).toHaveBeenLastCalledWith("pi", undefined, {
        baseModelId: "saved-local",
        effort: null,
      });
    });

    it("ignores an obsolete model-menu callback after the active conversation changes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { args, manager, session } = setup();
      const picker = buildAgentModelPicker(args)!;
      manager.getActiveSession.mockReturnValue({ ...session } as AgentSession);
      picker.onChange(key(picker));
      picker.effort?.onChange("high");
      expect(manager.applySelection).not.toHaveBeenCalled();
    });

    it("respects active model and reasoning locks and ignores unknown menu entries", () => {
      const { args, manager } = setup();
      manager.getActiveChatUIState.mockReturnValue({
        canSwitchModel: () => false,
        canSwitchEffort: () => false,
      });
      const picker = buildAgentModelPicker(args)!;
      expect(picker.disabled).toBe(true);
      expect(picker.effort?.disabled).toBe(true);
      picker.onChange(key(picker));
      picker.effort?.onChange("high");
      picker.onChange("unknown");
      expect(manager.applySelection).not.toHaveBeenCalled();
    });

    it("reports failed model, reasoning and initial-session requests through the existing notice", async () => {
      const { args, manager } = setup();
      const error = new Error("rejected");
      manager.applySelection.mockRejectedValue(error);
      const picker = buildAgentModelPicker(args)!;
      picker.onChange(key(picker));
      await manager.applySelection.mock.results[0].value.catch(() => undefined);
      expect(logError).toHaveBeenCalledWith("[AgentMode] model apply failed", error);
      picker.effort?.onChange("high");
      await manager.applySelection.mock.results[1].value.catch(() => undefined);
      expect(logError).toHaveBeenCalledWith("[AgentMode] effort apply failed", error);
      manager.getActiveSession.mockReturnValue(null);
      manager.createSession.mockRejectedValue(error);
      const empty = buildAgentModelPicker(args)!;
      empty.onChange(key(empty));
      await manager.createSession.mock.results[0].value.catch(() => undefined);
      expect(logError).toHaveBeenCalledWith("[AgentMode] model apply failed", error);
    });
  });
});
