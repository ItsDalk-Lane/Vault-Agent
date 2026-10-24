import { act, renderHook } from "@testing-library/react";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, BackendState } from "@/agentMode/session/types";
import { useAgentModelPicker } from "./useAgentModelPicker";

const mockDescriptor = { id: "pi" } as BackendDescriptor;
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real exported hook
  useSettingsValue: () => ({}),
}));
jest.mock("@/agentMode/backends/registry", () => ({
  creatableBackendDescriptors: () => [mockDescriptor],
}));
jest.mock("./agentModelPickerHelpers", () => ({
  buildAgentModelPicker: ({
    manager,
    descriptor,
  }: {
    manager: AgentSessionManager | null;
    descriptor: BackendDescriptor;
  }) =>
    manager
      ? {
          models: [],
          value: `${manager.getActiveSession()?.getState()?.model?.current.baseModelId ?? ""}:${manager.getModelCacheSignature(descriptor.id)}`,
          onChange: jest.fn(),
        }
      : null,
}));

function stateWithModel(baseModelId: string): BackendState {
  return {
    model: {
      current: { baseModelId, effort: null },
      availableModels: [],
      apply: { kind: "setModel" },
    },
    mode: null,
  };
}

describe("useAgentModelPicker", () => {
  describe("useAgentModelPicker()", () => {
    it("updates for the built-in session and model cache without subscribing to historical engine installation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      let state = stateWithModel("first");
      let catalog = "one";
      let activeListener: (() => void) | undefined;
      let cacheListener: (() => void) | undefined;
      const ui = {
        subscribe: (listener: () => void) => {
          activeListener = listener;
          return () => {
            activeListener = undefined;
          };
        },
      } as unknown as AgentChatUIState;
      const session = {
        internalId: "active",
        backendId: "pi",
        getStatus: () => "idle",
        getState: () => state,
        hasUserVisibleMessages: () => false,
      } as unknown as AgentSession;
      const getModelCacheSignature = jest.fn((_id: string) => catalog);
      const manager = {
        getActiveSession: () => session,
        getActiveChatUIState: () => ui,
        subscribe: () => () => undefined,
        subscribeModelCache: (listener: () => void) => {
          cacheListener = listener;
          return () => {
            cacheListener = undefined;
          };
        },
        getModelCacheSignature,
      } as unknown as AgentSessionManager;
      const { result, unmount } = renderHook(() => useAgentModelPicker(manager));
      expect(result.current?.value).toBe("first:one");
      state = stateWithModel("second");
      act(() => activeListener?.());
      expect(result.current?.value).toBe("second:one");
      catalog = "two";
      act(() => cacheListener?.());
      expect(result.current?.value).toBe("second:two");
      expect(getModelCacheSignature.mock.calls.every((args) => args[0] === "pi")).toBe(true);
      unmount();
      expect(activeListener).toBeUndefined();
      expect(cacheListener).toBeUndefined();
    });

    it("has no model override without a session manager", () => {
      const { result } = renderHook(() => useAgentModelPicker(null));
      expect(result.current).toBeNull();
    });
  });
});
