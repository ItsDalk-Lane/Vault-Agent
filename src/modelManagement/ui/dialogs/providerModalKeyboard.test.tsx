import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Scope } from "obsidian";
import { ConfigureProviderEditor } from "./ConfigureProviderEditor";
import { createModelDraft } from "./providerDraft";
import { createProviderModalScope } from "./providerModalKeyboard";

const mockScopes = new WeakMap<object, { parent?: object; escape?: () => boolean | void }>();
jest.mock("obsidian", () => ({
  ...jest.requireActual<object>("obsidian"),
  Scope: class {
    constructor(parent?: object) {
      mockScopes.set(this, { parent });
    }
    register(_modifiers: unknown, key: string, listener: () => boolean | void) {
      if (key === "Escape") mockScopes.get(this)!.escape = listener;
    }
  },
}));

function pressScopeEscape(scope: object): void {
  const current = mockScopes.get(scope)!;
  if (current.escape?.() === false) return;
  if (current.parent) pressScopeEscape(current.parent);
}
function mount() {
  const view = render(
    <ConfigureProviderEditor
      initialDraft={{
        displayName: "Provider",
        providerType: "openai-compatible",
        baseUrl: "https://service.example/v1",
        apiKey: "",
        extras: {},
        enabled: true,
        models: [createModelDraft({ id: "a", displayName: "A" }, true, true)],
      }}
      requiresApiKey={false}
      defaultBaseUrl={() => ""}
      catalogModels={[]}
      onTestModel={async () => {}}
      onSave={async () => {}}
      onClose={jest.fn()}
    />
  );
  const parentClose = jest.fn();
  const close = jest.fn();
  const parent = new Scope();
  parent.register([], "Escape", () => {
    parentClose();
    return false;
  });
  const scope = createProviderModalScope(parent, view.container, close);
  return { ...view, scope, close, parentClose };
}
const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";

describe("providerModalKeyboard", () => {
  describe("createProviderModalScope()", () => {
    it(`handles native scope Escape before the parent scope and only closes the provider when no child layer is open (${ISSUE})`, () => {
      const view = mount();
      act(() => pressScopeEscape(view.scope));
      expect(view.close).toHaveBeenCalledTimes(1);
      expect(view.parentClose).not.toHaveBeenCalled();
    });
    it(`closes open help through the native scope without closing the provider (${ISSUE})`, async () => {
      const view = mount();
      fireEvent.click(screen.getByRole("button", { name: "About Input types" }));
      expect(await screen.findByRole("dialog")).toBeTruthy();
      act(() => pressScopeEscape(view.scope));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(view.close).not.toHaveBeenCalled();
      expect(view.parentClose).not.toHaveBeenCalled();
    });
    it(`closes the controlled API format menu through the native scope (${ISSUE})`, async () => {
      const view = mount();
      fireEvent.keyDown(screen.getByRole("button", { name: "API format" }), { key: "Enter" });
      expect(await screen.findByRole("menu")).toBeTruthy();
      act(() => pressScopeEscape(view.scope));
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(view.close).not.toHaveBeenCalled();
      expect(view.parentClose).not.toHaveBeenCalled();
    });
    it(`closes model selection through the native scope and restores its opening button focus (${ISSUE})`, async () => {
      const view = mount();
      fireEvent.click(screen.getByRole("button", { name: "Choose built-in models" }));
      await screen.findByText(
        "No built-in models for this provider. Close this list and add a model ID manually."
      );
      act(() => pressScopeEscape(view.scope));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Choose built-in models" })
      );
      expect(view.close).not.toHaveBeenCalled();
      expect(view.parentClose).not.toHaveBeenCalled();
    });
    it(`cancels custom reasoning entry through the native scope without closing the provider (${ISSUE})`, () => {
      const view = mount();
      fireEvent.click(screen.getByRole("button", { name: "Add reasoning level" }));
      expect(screen.getByRole("textbox", { name: "Add reasoning level" })).toBeTruthy();
      act(() => pressScopeEscape(view.scope));
      expect(screen.queryByRole("textbox", { name: "Add reasoning level" })).toBeNull();
      expect(view.close).not.toHaveBeenCalled();
      expect(view.parentClose).not.toHaveBeenCalled();
    });
    it(`dismisses help before an underlying custom reasoning entry (${ISSUE})`, async () => {
      const view = mount();
      fireEvent.click(screen.getByRole("button", { name: "Add reasoning level" }));
      fireEvent.click(screen.getByRole("button", { name: "About Input types" }));
      await screen.findByRole("dialog");
      act(() => pressScopeEscape(view.scope));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByRole("textbox", { name: "Add reasoning level" })).toBeTruthy();
      act(() => pressScopeEscape(view.scope));
      expect(screen.queryByRole("textbox", { name: "Add reasoning level" })).toBeNull();
      expect(view.close).not.toHaveBeenCalled();
    });
  });
});
