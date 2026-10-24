import React from "react";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { AppContext } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { REPLAY_SAMPLE_ENTRIES } from "@/agentMode/sdk/pi/testing/replaySample";
import {
  namespacedToolCallId,
  toolDisplayMetadataFor,
} from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";
import type { AgentChatMessage, AgentMessagePart } from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";

// A recorded real-Harness turn must survive a close/reopen unchanged: text, code blocks, links,
// images and tool parts replay into the existing ChatSingleMessage/AgentTrail renderers, the copy
// action takes only the final answer, and missing state never fabricates a reply:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const mockCopyAnswer = jest.fn();
const h = React.createElement;

jest.mock("@/components/chat-components/CopyButton", () => {
  const react = jest.requireActual<typeof import("react")>("react");
  return {
    CopyButton: ({ text }: { text: string }) =>
      react.createElement(
        "button",
        { type: "button", "data-testid": "copy-answer", onClick: () => mockCopyAnswer(text) },
        "Copy"
      ),
  };
});

jest.mock("@/agentMode/ui/AgentMarkdownText", () => {
  const react = jest.requireActual<typeof import("react")>("react");
  return {
    AgentMarkdownText: ({ text }: { text: string }) =>
      react.createElement("div", { "data-testid": "agent-md" }, text),
  };
});

jest.mock("@/utils", () => ({
  cleanMessageForCopy: (value: string) => value.trim(),
  insertAtCursor: jest.fn(),
}));

jest.mock("@/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: jest.fn(() => ({ isCopied: false, copy: jest.fn() })),
}));

jest.mock("@/components/chat-components/InlineMessageEditor", () => {
  const react = jest.requireActual<typeof import("react")>("react");
  return {
    InlineMessageEditor: ({ initialValue }: { initialValue: string }) =>
      react.createElement("textarea", { "aria-label": "Edit message", defaultValue: initialValue }),
  };
});

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn(() => ({
    enableInlineCitations: true,
    activeModels: [{ name: "test-model", provider: "test-provider", enabled: true }],
  })),
  getSettings: jest.fn(() => ({ debug: false })),
}));

jest.mock("@/aiParams", () => ({
  useModelKey: jest.fn(() => ["test-model|test-provider", jest.fn()]),
}));

jest.mock("@/LLMProviders/chainRunner/utils/toolCallParser", () => ({
  parseToolCallMarkers: jest.fn((message: string) => ({
    segments: [{ type: "text", content: message }],
  })),
}));

jest.mock("@/LLMProviders/chainRunner/utils/citationUtils", () => ({
  processInlineCitations: jest.fn((content: string) => content),
}));

jest.mock("obsidian", () => {
  const renderMarkdown = jest.fn().mockResolvedValue(undefined);
  return {
    MarkdownRenderer: { render: renderMarkdown },
    Component: class {
      load() {}
      unload() {}
      register() {}
    },
    MarkdownView: class {},
    TFile: class {},
    App: class {},
    ItemView: class {
      containerEl = document.createElement("div");
    },
    WorkspaceLeaf: class {},
    FileSystemAdapter: class {},
    Notice: class {},
    Platform: { isMobile: false },
    Modal: class {
      open() {}
      close() {}
    },
    __renderMock: renderMarkdown,
  };
});

const { __renderMock: renderMarkdownMock } = jest.requireMock<{
  __renderMock: jest.Mock;
}>("obsidian");

function makeApp(): App {
  return {
    workspace: {
      getActiveFile: jest.fn(() => null),
      getMostRecentLeaf: jest.fn(() => null),
      getLeaf: jest.fn(() => null),
    },
    metadataCache: { getFirstLinkpathDest: jest.fn(() => null) },
  } as unknown as App;
}

const TEST_APP = makeApp();

function renderWithApp(ui: React.ReactElement) {
  return render(h(AppContext.Provider, { value: TEST_APP }, h(TooltipProvider, null, ui)));
}

function textOf(content: UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((item): item is { type: "text"; text: string } => item.type === "text")
    .map((item) => item.text)
    .join("");
}

function textOfMessage(
  content: Extract<Message, { role: "assistant" | "toolResult" }>["content"]
): string {
  if (typeof content === "string") return content;
  return content
    .filter((item): item is { type: "text"; text: string } => item.type === "text")
    .map((item) => item.text)
    .join("");
}

function sampleModel(kind: string): Message[] {
  return REPLAY_SAMPLE_ENTRIES.filter((entry) => entry.kind === kind).flatMap((entry) => [
    ...(entry.model ?? []),
  ]);
}

function reopenedMessages(): AgentChatMessage[] {
  const user = sampleModel("pi.user")[0];
  if (user?.role !== "user") throw new Error("the fixture has no user message");
  const assistantBlocks = sampleModel("pi.assistant").flatMap((message) =>
    message.role === "assistant" ? [...message.content] : []
  );
  const toolCall = assistantBlocks.find((block) => block.type === "toolCall");
  if (toolCall?.type !== "toolCall") throw new Error("the fixture has no tool call");
  const answer = assistantBlocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
  const toolResult = sampleModel("pi.tool-result")[0];
  const toolOutput = toolResult?.role === "toolResult" ? textOfMessage(toolResult.content) : "";
  const display = toolDisplayMetadataFor(toolCall.name);

  const userContent = typeof user.content === "string" ? [] : user.content;
  return [
    {
      id: "user-1",
      sender: USER_SENDER,
      timestamp: null,
      isVisible: true,
      message: textOf(user.content),
      content: userContent
        .filter((item): item is { type: "image"; data: string; mimeType: string } => {
          return item.type === "image";
        })
        .map((image) => ({
          type: "image_url",
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
    },
    {
      id: "assistant-1",
      sender: AI_SENDER,
      timestamp: null,
      isVisible: true,
      message: answer,
      parts: [
        {
          kind: "tool_call",
          id: namespacedToolCallId("replay", toolCall.id),
          title: display.title,
          toolKind: display.toolKind,
          vendorToolName: display.vendorToolName,
          status: "completed",
          input: toolCall.arguments,
          output: [{ type: "text", text: toolOutput }],
        },
        { kind: "text", text: answer },
      ],
      turnStopReason: "end_turn",
      turnDurationMs: 12_000,
    },
  ];
}

function toChatMessage(message: AgentChatMessage): ChatMessage {
  return {
    id: message.id,
    sender: message.sender,
    message: message.message,
    timestamp: message.timestamp,
    isVisible: message.isVisible,
    content: message.content,
  };
}

function replayed(): AgentChatMessage[] {
  // Closing and reopening persists the display messages and loads them again:
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  return JSON.parse(JSON.stringify(reopenedMessages())) as AgentChatMessage[];
}

describe("ReplayIntegration", () => {
  beforeEach(() => {
    mockCopyAnswer.mockReset();
    renderMarkdownMock.mockReset();
    renderMarkdownMock.mockImplementation(async (_app: unknown, text: string, el: HTMLElement) => {
      if (text.includes("```")) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = "const answer = 42;";
        pre.append(code);
        el.append(pre);
      }
      if (text.includes("[the plan]")) {
        const link = document.createElement("a");
        link.href = "Notes/plan.md";
        link.textContent = "the plan";
        el.append(link);
      }
      if (!el.textContent) el.textContent = text;
    });
  });

  describe("reopening a recorded turn", () => {
    it("keeps the committed order and renders its code block and link", async () => {
      const first = replayed();
      const second = JSON.parse(JSON.stringify(first)) as AgentChatMessage[];

      expect(first.map((message) => message.id)).toEqual(["user-1", "assistant-1"]);
      expect(second).toEqual(first);
      expect(first[0]?.message).toBe("Review this plan");
      expect(first[1]?.parts?.map((part) => part.kind)).toEqual(["tool_call", "text"]);

      const answer = first[1]?.message ?? "";
      expect(answer).toContain("```ts");
      expect(answer).toContain("[the plan](Notes/plan.md)");

      const { container } = renderWithApp(
        h(ChatSingleMessage, {
          message: toChatMessage(first[1]),
          app: TEST_APP,
          isStreaming: false,
        })
      );

      await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());
      expect(renderMarkdownMock.mock.calls[0][1]).toBe(answer);
      expect(container.querySelector("pre code")?.textContent).toBe("const answer = 42;");
      expect(screen.getByText("the plan")).toBeTruthy();
    });
  });

  describe("copying a replayed answer", () => {
    it("copies only the final answer, not reasoning or tool diagnostics", () => {
      const messages = replayed();
      const assistant = messages[1];
      const parts: AgentMessagePart[] = [
        { kind: "thought", text: "internal reasoning that must stay out of the copy" },
        ...(assistant.parts ?? []),
      ];
      const answer = assistant.message;

      renderWithApp(
        h(AgentTrail, {
          parts,
          isStreaming: false,
          turnStopReason: "end_turn",
          turnDurationMs: assistant.turnDurationMs,
          app: TEST_APP,
        })
      );

      screen.getByTestId("copy-answer").click();

      expect(mockCopyAnswer).toHaveBeenCalledWith(answer);
      expect(mockCopyAnswer.mock.calls[0][0]).not.toContain("internal reasoning");
      expect(mockCopyAnswer.mock.calls[0][0]).not.toContain("read_note");
    });

    it("does not offer copy or a final answer for a compaction-only replay", () => {
      renderWithApp(
        h(AgentTrail, {
          parts: [
            {
              kind: "compaction",
              id: "compaction-1",
              status: "completed",
              trigger: "manual",
              startedAtMs: 1_000,
            },
          ],
          isStreaming: false,
          turnStopReason: "end_turn",
          app: TEST_APP,
        })
      );

      expect(screen.queryByTestId("copy-answer")).toBeNull();
      expect(screen.queryByTestId("agent-md")).toBeNull();
    });
  });

  describe("reopening images", () => {
    it("renders the surviving image and shows a placeholder for one whose payload is gone", async () => {
      const messages = replayed();
      const user = messages[0];
      user.content = [...(user.content ?? []), { type: "image_url" }];

      const { container } = renderWithApp(
        h(ChatSingleMessage, {
          message: toChatMessage(user),
          app: TEST_APP,
          isStreaming: false,
        })
      );

      await waitFor(() => expect(screen.getByText("Image unavailable")).toBeTruthy());
      const image = container.querySelector("img.chat-message-image");
      expect(image?.getAttribute("src")).toContain("data:image/png;base64,");
      expect(screen.getByTestId("message-image-placeholder")).toBeTruthy();
    });
  });
});
