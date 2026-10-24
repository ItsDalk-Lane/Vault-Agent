import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ConfigureProviderEditor,
  type ConfigureProviderEditorProps,
} from "./ConfigureProviderEditor";
import { createModelDraft, type ProviderDraft } from "./providerDraft";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";
const initialDraft = (): ProviderDraft => ({
  displayName: "Provider",
  providerType: "openai-compatible",
  baseUrl: "https://service.example/v1",
  apiKey: "",
  extras: {},
  enabled: true,
  models: [],
});
function mount(overrides: Partial<ConfigureProviderEditorProps> = {}) {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onFetchModels = jest.fn().mockResolvedValue([
    { id: "a", displayName: "A" },
    { id: "b", displayName: "B" },
  ]);
  const props = {
    initialDraft: initialDraft(),
    requiresApiKey: false,
    defaultBaseUrl: () => "https://service.example/v1",
    onFetchModels,
    onTestModel: jest.fn().mockResolvedValue(undefined),
    onSave,
    onClose: jest.fn(),
    ...overrides,
  };
  render(<ConfigureProviderEditor {...props} />);
  return props;
}
function addModel(id = "manual-model") {
  fireEvent.click(screen.getByRole("button", { name: "Add model" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Model ID" }), { target: { value: id } });
}

describe("ConfigureProviderEditor", () => {
  describe("ConfigureProviderEditor()", () => {
    it(`keeps help inside the modal when it is the first interaction (${ISSUE})`, async () => {
      mount({
        initialDraft: {
          ...initialDraft(),
          models: [createModelDraft({ id: "ready", displayName: "Ready" }, true, true)],
        },
      });
      const root = screen.getByRole("heading", { name: "Model configuration" }).parentElement!
        .parentElement!;
      fireEvent.click(screen.getByRole("button", { name: "About Input types" }));
      const help = await screen.findByRole("dialog");
      expect(root.contains(help)).toBe(true);
    });

    it(`saves an empty provider and keeps all edits local until Save (${ISSUE})`, async () => {
      const props = mount();
      fireEvent.click(screen.getByRole("switch", { name: "Enable this provider" }));
      expect(props.onSave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith(
          expect.objectContaining({ enabled: false, models: [] })
        )
      );
    });
    it(`adds a focused expanded card, synchronizes the ID, and saves image and reasoning declarations (${ISSUE})`, async () => {
      const props = mount();
      addModel("vision-model");
      expect(screen.getByRole("textbox", { name: "Model ID" })).toBe(document.activeElement);
      expect(screen.getByRole("button", { name: "vision-model" })).toBeTruthy();
      fireEvent.change(screen.getByRole("textbox", { name: "Context window" }), {
        target: { value: "1M" },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "Maximum output tokens" }), {
        target: { value: "384K" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Image" }));
      fireEvent.click(screen.getByRole("button", { name: "low" }));
      fireEvent.click(screen.getByRole("button", { name: "high" }));
      fireEvent.click(screen.getByRole("button", { name: "Text" }));
      expect(screen.getByRole("status").textContent).toContain("Text is required");
      expect(screen.getByText("Vision")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            models: [
              expect.objectContaining({
                info: expect.objectContaining({
                  id: "vision-model",
                  limits: { context: 1000000, output: 384000 },
                  modalities: { input: ["text", "image"] },
                  reasoningEfforts: ["low", "high"],
                }) as unknown,
              }),
            ],
          })
        )
      );
    });
    it(`blocks empty, repeated IDs and invalid limits with inline explanations (${ISSUE})`, () => {
      mount();
      addModel("a");
      fireEvent.change(screen.getByRole("textbox", { name: "Context window" }), {
        target: { value: "-5" },
      });
      expect(screen.getByText("Enter a positive whole number or a K/M value.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
      fireEvent.change(screen.getByRole("textbox", { name: "Context window" }), {
        target: { value: "1M" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add model" }));
      fireEvent.change(screen.getAllByRole("textbox", { name: "Model ID" })[1], {
        target: { value: "a" },
      });
      expect(screen.getAllByText("Enter a unique model ID.")).toHaveLength(2);
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    });
    it(`restores declared pills, supports custom reasoning levels, and removes selected custom levels (${ISSUE})`, async () => {
      const props = mount({
        initialDraft: {
          ...initialDraft(),
          models: [
            createModelDraft(
              {
                id: "a",
                displayName: "A",
                modalities: { input: ["text", "image"] },
                capabilities: { structuredOutput: true, midConversationSystemMessages: true },
                reasoningEfforts: ["high"],
              },
              true,
              true
            ),
          ],
        },
      });
      expect(
        screen.getByRole("button", { name: "Structured output" }).getAttribute("aria-pressed")
      ).toBe("true");
      expect(
        screen
          .getByRole("button", { name: "Mid-conversation system messages" })
          .getAttribute("aria-pressed")
      ).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Add reasoning level" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Add reasoning level" }), {
        target: { value: "high" },
      });
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Add reasoning level" }), {
        key: "Enter",
      });
      expect(screen.getByRole("status").textContent).toBe("This level already exists.");
      fireEvent.change(screen.getByRole("textbox", { name: "Add reasoning level" }), {
        target: { value: "balanced" },
      });
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Add reasoning level" }), {
        key: "Enter",
      });
      expect(screen.getByRole("button", { name: "balanced" }).getAttribute("aria-pressed")).toBe(
        "true"
      );
      fireEvent.click(screen.getByRole("button", { name: "Remove reasoning level balanced" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            models: [
              expect.objectContaining({
                info: expect.objectContaining({ reasoningEfforts: ["high"] }) as unknown,
              }),
            ],
          })
        )
      );
    });
    it(`disables unsupported PDF, video, native search and Google request capabilities with reasons (${ISSUE})`, () => {
      mount({
        initialDraft: {
          ...initialDraft(),
          providerType: "google",
          models: [createModelDraft({ id: "a", displayName: "a" }, true, true)],
        },
      });
      for (const name of [
        "Video",
        "PDF",
        "Native web search",
        "Structured output",
        "Mid-conversation system messages",
        "Add reasoning level",
      ])
        expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByText(/Video cannot be sent yet/)).toBeTruthy();
    });
    it(`fetches real models only on request, filters duplicates, searches and resets selection on reopen (${ISSUE})`, async () => {
      const props = mount({
        initialDraft: {
          ...initialDraft(),
          models: [createModelDraft({ id: "a", displayName: "A" })],
        },
      });
      expect(props.onFetchModels).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Get model list" }));
      const dialog = await screen.findByRole("dialog");
      await waitFor(() =>
        expect(within(dialog).getByRole("checkbox", { name: "a" }).hasAttribute("disabled")).toBe(
          true
        )
      );
      expect(within(dialog).getByRole("textbox")).toBe(document.activeElement);
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "missing" } });
      expect(within(dialog).getByText("No matching models")).toBeTruthy();
      fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "b" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Select all" }));
      expect(within(dialog).getByRole("button", { name: "Add selected (1)" })).toBeTruthy();
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Get model list" }));
      await screen.findByRole("checkbox", { name: "b" });
      expect(
        screen.getByRole("button", { name: "Add selected (0)" }).hasAttribute("disabled")
      ).toBe(true);
      fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
      fireEvent.click(screen.getByRole("button", { name: "Add selected (1)" }));
      expect(screen.getByRole("button", { name: "b" })).toBeTruthy();
    });
    it(`shows a fetch failure inline and retries instead of adding fake models (${ISSUE})`, async () => {
      const fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce([{ id: "real", displayName: "real" }]);
      mount({ onFetchModels: fetch });
      fireEvent.click(screen.getByRole("button", { name: "Get model list" }));
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        expect.stringContaining("offline")
      );
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByRole("checkbox", { name: "real" })).toBeTruthy();
    });
    it(`tests a real reply with unsaved edits and reports request failure even when model listing succeeds (${ISSUE})`, async () => {
      let finish!: () => void;
      const test = jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            })
        )
        .mockRejectedValueOnce(new Error("chat blocked"));
      const props = mount({
        initialDraft: {
          ...initialDraft(),
          models: [createModelDraft({ id: "a", displayName: "A" }, true, true)],
        },
        ...{ onTestModel: test },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "Model ID" }), {
        target: { value: "unsaved-model" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Check unsaved-model" }));
      fireEvent.click(screen.getByRole("button", { name: "Check unsaved-model" }));
      expect(test).toHaveBeenCalledTimes(1);
      expect(test).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "https://service.example/v1" }),
        expect.objectContaining({ id: "unsaved-model" }),
        expect.any(AbortSignal)
      );
      expect(props.onFetchModels).not.toHaveBeenCalled();
      expect(props.onSave).not.toHaveBeenCalled();
      act(() => finish());
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe(
          "Connection and tool verification passed: unsaved-model"
        )
      );
      fireEvent.click(screen.getByRole("button", { name: "Check unsaved-model" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("chat blocked"));
    });
    it(`aborts a pending model test when the editor closes (${ISSUE})`, async () => {
      let signal!: AbortSignal;
      const test = jest.fn(
        (_draft: ProviderDraft, _model: unknown, requestSignal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal = requestSignal;
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Model test cancelled", "AbortError")),
              { once: true }
            );
          })
      );
      const view = render(
        <ConfigureProviderEditor
          initialDraft={{
            ...initialDraft(),
            models: [createModelDraft({ id: "pending", displayName: "Pending" })],
          }}
          requiresApiKey={false}
          defaultBaseUrl={() => ""}
          onFetchModels={jest.fn()}
          onTestModel={test}
          onSave={jest.fn()}
          onClose={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Check pending" }));
      expect(signal.aborted).toBe(false);
      view.unmount();
      expect(signal.aborted).toBe(true);
    });
    it.each(["Failed to fetch", "HTTP 401 invalid key"])(
      `explains Google access requirements and preserves the actual test failure: %s (${ISSUE})`,
      async (reason) => {
        mount({
          initialDraft: {
            ...initialDraft(),
            providerType: "google",
            models: [createModelDraft({ id: "gemini", displayName: "Gemini" })],
          },
          onTestModel: async () => {
            throw new Error(reason);
          },
        });
        expect(
          screen.getByText(/Custom gateways must allow Obsidian cross-origin requests/)
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Check gemini" }));
        await waitFor(() => expect(screen.getByRole("status").textContent).toContain(reason));
        expect(screen.getByRole("status").textContent?.includes("Check connectivity")).toBe(
          reason === "Failed to fetch"
        );
      }
    );
    it(`collapses cards, keeps model display separate from provider enablement, and deletes after animation (${ISSUE})`, async () => {
      const props = mount({
        initialDraft: {
          ...initialDraft(),
          models: [createModelDraft({ id: "a", displayName: "A" }, true, true)],
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Collapse model" }));
      expect(screen.queryByRole("textbox", { name: "Model ID" })).toBeNull();
      fireEvent.click(screen.getByRole("switch", { name: "Show a in model pickers" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            enabled: true,
            models: [expect.objectContaining({ enabled: false })],
          })
        )
      );
      fireEvent.click(screen.getByRole("button", { name: "Delete a" }));
      expect(screen.getByText(/No models yet/)).toBeTruthy();
    });

    it(`loads declarations for a manual ID without overwriting user changes made during lookup (${ISSUE})`, async () => {
      let finish!: (info: Partial<import("@/modelManagement/types/catalog").ModelInfo>) => void;
      const resolve = jest.fn().mockImplementation(
        () =>
          new Promise((done) => {
            finish = done;
          })
      );
      mount({ resolveModelInfo: resolve });
      addModel("declared");
      fireEvent.blur(screen.getByRole("textbox", { name: "Model ID" }));
      fireEvent.click(screen.getByRole("button", { name: "Image" }));
      act(() =>
        finish({
          modalities: { input: ["text"] },
          capabilities: { structuredOutput: true },
          reasoningEfforts: ["medium"],
          limits: { context: 200000 },
        })
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Structured output" }).getAttribute("aria-pressed")
        ).toBe("true")
      );
      expect(screen.getByRole("button", { name: "Image" }).getAttribute("aria-pressed")).toBe(
        "true"
      );
      expect(screen.getByRole("button", { name: "medium" }).getAttribute("aria-pressed")).toBe(
        "true"
      );
      expect(screen.getByRole("textbox", { name: "Context window" })).toHaveProperty(
        "value",
        "200000"
      );
    });
    it(`offers exactly four formats and preserves custom endpoints when switching (${ISSUE})`, async () => {
      mount({
        defaultBaseUrl: (type) =>
          type === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1",
      });
      const trigger = screen.getByRole("button", { name: "API format" });
      fireEvent.keyDown(trigger, { key: "Enter" });
      const options = await screen.findAllByRole("menuitem");
      expect(options.map((option) => option.textContent)).toEqual([
        "OpenAI Chat Completions",
        "OpenAI Responses",
        "Anthropic Messages",
        "Google Generative AI",
      ]);
      fireEvent.click(screen.getByRole("menuitem", { name: "Anthropic Messages" }));
      expect(screen.getByRole("textbox", { name: "Base URL" })).toHaveProperty(
        "value",
        "https://service.example/v1"
      );
      expect(screen.getByRole("status").textContent).toContain("Anthropic Messages");
    });
    it(`shows help content on click and closes it with Escape (${ISSUE})`, async () => {
      mount({
        initialDraft: {
          ...initialDraft(),
          models: [createModelDraft({ id: "a", displayName: "a" }, true, true)],
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "About Input types" }));
      const help = await screen.findByRole("dialog");
      expect(help.textContent).toContain("content types the model can receive");
      fireEvent.keyDown(help, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it.each([
      "https://user:secret@example.com/v1",
      "https://example.com/v1?key=x",
      "https://{host}/v1",
    ])(`rejects an endpoint that the shared runtime policy refuses: %s (${ISSUE})`, (baseUrl) => {
      mount({ initialDraft: { ...initialDraft(), baseUrl } });
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByText("Enter a valid HTTP or HTTPS Base URL.")).toBeTruthy();
    });
    it(`removes OpenAI-only organization metadata when changing to another protocol (${ISSUE})`, async () => {
      const props = mount({
        initialDraft: {
          ...initialDraft(),
          extras: { openAIOrgId: "org-123", useResponsesApi: false },
        },
      });
      fireEvent.keyDown(screen.getByRole("button", { name: "API format" }), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: "Anthropic Messages" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith(
          expect.objectContaining({ providerType: "anthropic", extras: { useResponsesApi: false } })
        )
      );
    });

    it(`disables and removes max reasoning when the API cannot send that level (${ISSUE})`, async () => {
      const props = mount({
        initialDraft: {
          ...initialDraft(),
          providerType: "google",
          models: [
            createModelDraft(
              { id: "a", displayName: "A", reasoningEfforts: ["low", "max"] },
              true,
              true
            ),
          ],
        },
      });
      expect(screen.getByRole("button", { name: "max" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "max" }).getAttribute("aria-pressed")).toBe(
        "false"
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(props.onSave).toHaveBeenCalled());
      const saved = jest.mocked(props.onSave).mock.calls[0][0] as ProviderDraft;
      expect(saved.models[0].info.reasoningEfforts).toEqual(["low"]);
    });

    it(`blocks Save until an actual deletion animation finishes, then saves the remaining draft (${ISSUE})`, async () => {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const props = mount({
        initialDraft: {
          ...initialDraft(),
          models: [createModelDraft({ id: "a", displayName: "A" })],
        },
      });
      const card = screen.getByRole("article", { name: "a" });
      Object.defineProperty(card, "getAnimations", { value: () => [{ finished }] });
      fireEvent.click(screen.getByRole("button", { name: "Delete a" }));
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
      await act(async () => {
        finish();
        await finished;
      });
      expect(screen.getByText(/No models yet/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ models: [] }))
      );
    });
    it(`deletes immediately when the host disables CSS transitions (${ISSUE})`, () => {
      mount({
        initialDraft: {
          ...initialDraft(),
          models: [createModelDraft({ id: "a", displayName: "A" })],
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Delete a" }));
      expect(screen.getByText(/No models yet/)).toBeTruthy();
    });
    it(`cancels without persistence and clears the toast on unmount (${ISSUE})`, () => {
      const onSave = jest.fn();
      const onClose = jest.fn();
      const { unmount } = render(
        <ConfigureProviderEditor
          initialDraft={initialDraft()}
          requiresApiKey={false}
          defaultBaseUrl={() => ""}
          onFetchModels={jest.fn()}
          onTestModel={jest.fn()}
          onSave={onSave}
          onClose={onClose}
        />
      );
      addModel();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      unmount();
    });
  });
});
