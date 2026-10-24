import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { expandCustomCommandPrefix } from "@/agentMode/session/expandCustomCommandPrefix";
import { resolveActiveNoteToken } from "@/agentMode/session/resolveActiveNoteToken";
import type { QueuedAgentMessage } from "@/agentMode/session/AgentInputDraftStore";
import type { PromptContent } from "@/agentMode/session/types";
import type { AgentInputDraftControls } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import {
  clearSelectedTextContexts,
  removeSelectedTextContext,
  useSelectedTextContexts,
} from "@/aiParams";
import { isCompactCommand } from "@/commands/compactCommand";
import { resolveCustomCommandModel } from "@/commands/resolveCustomCommandModel";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import ChatInput, {
  type ChatInputHandle,
  type ChatInputProps,
} from "@/components/chat-components/ChatInput";
import { useActiveWebTabState } from "@/components/chat-components/hooks/useActiveWebTabState";
import { ACTIVE_WEB_TAB_MARKER, EVENT_NAMES } from "@/constants";
import { EventTargetContext } from "@/context";
import { t } from "@/i18n";
import { logError, logWarn } from "@/logger";
import { useFanoutModelBrands } from "@/agentMode/ui/mentionedAgents";
import {
  configuredFanoutModels,
  resolveAnswererModels,
} from "@/agentMode/session/fanout/answerers";
import type { BackendId } from "@/agentMode/session/types";
import type VaultAgentPlugin from "@/main";
import { buildWebTabsWithActiveSnapshot } from "@/services/webViewerService/activeWebTabSnapshot";
import {
  isNoteSelectedTextContext,
  type MessageContext,
  type SelectedTextContext,
  type WebTabContext,
} from "@/types/message";
import { getModelKeyFromModel, useSettingsValue } from "@/settings/model";
import { modelSupportsVision } from "@/utils";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { mergeWebTabContexts } from "@/utils/urlNormalization";
import { AgentBackgroundTaskAction } from "@/agentMode/ui/AgentBackgroundTaskAction";
import { AgentSteerAction } from "@/agentMode/ui/AgentSteerAction";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { App, Notice, TFile } from "obsidian";
import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface AgentChatInputProps {
  backend: AgentChatBackend;
  plugin: VaultAgentPlugin;
  chatInputId: string;
  draft: AgentInputDraftControls;
  app: App;
  mainAgentId: BackendId | null;
  updateUserMessageHistory: (newMessage: string) => void;
  isStarting: boolean;
  isLoading: boolean;
  hasPendingPlanPermission: boolean;
  modelPickerOverride: ChatInputProps["modelPickerOverride"];
  modePickerOverride: ChatInputProps["modePickerOverride"];
  onCycleMode: () => void;
  disabled?: boolean;
}

const dedupeBy = <T,>(items: Iterable<T>, key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
};

const buildMessageContext = (
  notes: TFile[],
  selected: readonly SelectedTextContext[],
  webTabs: readonly WebTabContext[] = []
): MessageContext | undefined => {
  if (notes.length === 0 && selected.length === 0 && webTabs.length === 0) return undefined;
  return {
    notes,
    urls: [],
    selectedTextContexts: selected.length > 0 ? [...selected] : undefined,
    webTabs: webTabs.length > 0 ? [...webTabs] : undefined,
  };
};

const combineQueuedMessages = (items: QueuedAgentMessage[]): QueuedAgentMessage => {
  if (items.length === 1) return items[0];

  const allNotes = items.flatMap((i) => i.context?.notes ?? []);
  const allSelected = items.flatMap((i) => i.context?.selectedTextContexts ?? []);
  const allWebTabs = items.flatMap((i) => i.context?.webTabs ?? []);
  const allPromptContent = items.flatMap((i) => i.promptContent ?? []);
  const mergedAgents = dedupeBy(
    items.flatMap((i) => i.mentionedAgents ?? []),
    (id) => id
  );

  return {
    id: `queued-combined-${uuidv4()}`,
    text: items.map((i) => i.text).join("\n\n"),
    rawInput: items.map((i) => i.rawInput).join("\n\n"),
    context: buildMessageContext(
      dedupeBy(allNotes, (n) => n.path),
      dedupeBy(allSelected, (s) => s.id),
      mergeWebTabContexts(allWebTabs)
    ),
    promptContent: allPromptContent.length > 0 ? allPromptContent : undefined,
    mentionedAgents: mergedAgents.length > 0 ? mergedAgents : undefined,
    commandModelId: items[0].commandModelId,
    commandContext: items[0].commandContext,
  };
};

// Agents only compact when /compact is the whole prompt, so a queued one never merges with neighbours.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/634
const takeNextQueuedBatch = (
  items: QueuedAgentMessage[]
): { batch: QueuedAgentMessage[]; rest: QueuedAgentMessage[] } => {
  const nextCompact = items.findIndex((item) => isCompactCommand(item.text));
  const firstModel = items[0].commandModelId;
  // 不同命令指定的模型不能在排队时合并成一次请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  const nextModel = items.findIndex((item) => item.commandModelId !== firstModel);
  const compactEnd = nextCompact === 0 ? 1 : nextCompact === -1 ? items.length : nextCompact;
  const end = nextModel === -1 ? compactEnd : Math.min(compactEnd, nextModel);
  return { batch: items.slice(0, end), rest: items.slice(end) };
};

async function fileToImageBlock(file: File): Promise<PromptContent | null> {
  try {
    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0) return null;
    return { type: "image", mimeType: file.type || "image/png", data: arrayBufferToBase64(buf) };
  } catch (e) {
    logWarn("[AgentMode] failed to read attached image", e);
    return null;
  }
}

function imageBlockToFile(block: PromptContent, index: number): File | null {
  if (block.type !== "image") return null;
  const extension = block.mimeType.split("/")[1] || "png";
  return new File([base64ToArrayBuffer(block.data)], `queued-image-${index + 1}.${extension}`, {
    type: block.mimeType,
  });
}

export const AgentChatInput = memo(function AgentChatInput({
  backend,
  plugin,
  chatInputId,
  draft,
  app,
  mainAgentId,
  updateUserMessageHistory,
  isStarting,
  isLoading: loading,
  hasPendingPlanPermission,
  modelPickerOverride,
  modePickerOverride,
  onCycleMode,
  disabled = false,
}: AgentChatInputProps) {
  const eventTarget = useContext(EventTargetContext);
  const chatInputRef = useRef<ChatInputHandle>(null);

  const [selectedTextContexts] = useSelectedTextContexts();
  const { activeWebTabForMentions } = useActiveWebTabState();

  const previousChatInputIdRef = useRef(chatInputId);

  const agentBrands = useFanoutModelBrands();
  const settings = useSettingsValue();
  const availableFanoutModels = useMemo(() => configuredFanoutModels(settings), [settings]);
  const mentionedAgentIdsRef = useRef<string[]>([]);
  const handleMentionedAgentsChange = useCallback((backendIds: string[]) => {
    mentionedAgentIdsRef.current = backendIds;
  }, []);

  const {
    input: inputMessage,
    images: selectedImages,
    contextNotes,
    includeActiveNote,
    includeActiveWebTab,
    queue: queuedMessages,
    setInput: setInputMessage,
    setContextNotes,
    setSelectedImages,
    addImages,
    setIncludeActiveNote,
    setIncludeActiveWebTab,
    setLoading,
    setQueue: setQueuedMessages,
    resetCompose,
  } = draft;
  const activeModelEntry = modelPickerOverride?.models.find(
    (model) => getModelKeyFromModel(model) === modelPickerOverride.value
  );
  const unsupportedImageModelLabelFor = useCallback(
    (commandModelId?: string) => {
      const entry = commandModelId
        ? modelPickerOverride?.models.find((model) => model.name === commandModelId)
        : activeModelEntry;
      return Array.isArray(entry?.capabilities) && !modelSupportsVision(entry)
        ? entry.displayName || entry.name
        : null;
    },
    [activeModelEntry, modelPickerOverride?.models]
  );

  useEffect(() => {
    if (previousChatInputIdRef.current === chatInputId) return;
    previousChatInputIdRef.current = chatInputId;
    clearSelectedTextContexts();
    mentionedAgentIdsRef.current = [];
  }, [chatInputId]);

  const handleStopGenerating = useCallback(async () => {
    // Restore before cancellation can finish the turn and flush the queue.
    // Only runSend owns loading; a late cancel must not mark a newer turn idle.
    // Selected text remains ephemeral and is deliberately not restored.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/365
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/485
    setQueuedMessages([]);
    if (queuedMessages.length > 0) {
      // Merged into one draft, /compact would swallow the queued messages as compaction input.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
      const nonCompact = queuedMessages.filter((item) => !isCompactCommand(item.text));
      const restored = combineQueuedMessages(nonCompact.length > 0 ? nonCompact : queuedMessages);
      // A fixed copy of the current page would duplicate its Active Web Tab badge and outlive
      // that badge's removal. https://github.com/Brevilabs/obsidian-copilot-private/issues/667
      const activeUrl = activeWebTabForMentions?.url;
      const restoredWebTabs = restored.context?.webTabs ?? [];
      if (restoredWebTabs.some((tab) => tab.url === activeUrl)) setIncludeActiveWebTab(true);
      chatInputRef.current?.prependContent(
        restored.text,
        restored.mentionedAgents ?? [],
        restoredWebTabs.filter((tab) => tab.url !== activeUrl)
      );
      // A fixed copy of the active note would duplicate its Active Note badge and outlive that
      // badge's removal. https://github.com/Brevilabs/obsidian-copilot-private/issues/670
      const activePath = app.workspace.getActiveFile()?.path;
      const restoredNotes = restored.context?.notes ?? [];
      if (restoredNotes.some((note) => note.path === activePath)) setIncludeActiveNote(true);
      const notes = restoredNotes.filter((note) => note.path !== activePath);
      if (notes.length > 0) {
        setContextNotes((previous) => dedupeBy([...notes, ...previous], (note) => note.path));
      }
      const images = (restored.promptContent ?? [])
        .map(imageBlockToFile)
        .filter((file): file is File => file !== null);
      if (images.length > 0) setSelectedImages((previous) => [...images, ...previous]);
    }
    try {
      await backend.cancel();
    } catch (e) {
      logError("[AgentMode] cancel failed", e);
    }
  }, [
    activeWebTabForMentions,
    app,
    backend,
    queuedMessages,
    setContextNotes,
    setIncludeActiveNote,
    setIncludeActiveWebTab,
    setSelectedImages,
    setQueuedMessages,
  ]);

  const runSend = useCallback(
    async (item: QueuedAgentMessage) => {
      setLoading(true);
      try {
        if (item.commandModelId) {
          const manager = plugin.agentSessionManager;
          try {
            const session = manager
              ?.getSessions()
              .find((candidate) => candidate.chatInputId === chatInputId);
            if (!session) throw new Error(t("notice.commandModelUnavailable"));
            // 等待模型真正切换后再发请求，后台标签不能借用当前活动聊天。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
            await session.applyModelWireId(item.commandModelId);
          } catch (error) {
            // 还未交给后端的命令必须回到草稿，切换失败不能丢掉选区和附件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
            manager?.drafts.update(chatInputId, (current) => ({
              ...current,
              input: [item.rawInput, current.input].filter((text) => text.trim()).join("\n\n"),
              images: [
                ...(item.promptContent ?? [])
                  .map(imageBlockToFile)
                  .filter((file): file is File => file !== null),
                ...current.images,
              ],
              contextNotes: dedupeBy(
                [...(item.context?.notes ?? []), ...current.contextNotes],
                (note) => note.path
              ),
              ...(item.commandContext ? { commandContext: item.commandContext } : {}),
            }));
            throw error;
          }
        }
        const { turn } = backend.sendMessage(
          item.text,
          item.context,
          item.promptContent,
          item.mentionedAgents
        );
        if (item.rawInput) updateUserMessageHistory(item.rawInput);
        await turn;
      } catch (error) {
        logError("Error sending agent message:", error);
        new Notice(t("notice.sendFailed"));
      } finally {
        setLoading(false);
      }
    },
    [backend, plugin, chatInputId, setLoading, updateUserMessageHistory]
  );

  const handleSendMessage = useCallback(
    async (webTabs?: WebTabContext[]) => {
      if (disabled) return;
      const text = inputMessage.trim();
      if (!text && selectedImages.length === 0) return;
      const rawInput = inputMessage;

      const activeFile = draft.commandContext
        ? draft.commandContext.activeFile
        : app.workspace.getActiveFile();

      const candidateNotes: TFile[] = [];
      if (includeActiveNote && activeFile) {
        candidateNotes.push(activeFile);
      }
      candidateNotes.push(...contextNotes);
      const notes = dedupeBy(candidateNotes, (n) => n.path);

      const noteSelection = selectedTextContexts.find(isNoteSelectedTextContext);
      const expanded = await expandCustomCommandPrefix(
        text,
        getCachedCustomCommands(),
        draft.commandContext?.selectedText ?? noteSelection?.content ?? "",
        activeFile,
        settings.enableCustomPromptTemplating !== false
      );
      const commandSelection = expanded.matched?.modelKey;
      const commandModelId = commandSelection
        ? resolveCustomCommandModel(plugin.modelManagement, commandSelection)
        : undefined;
      if (commandSelection && !commandModelId) {
        new Notice(t("notice.commandModelUnavailable"));
        return;
      }
      if (expanded.matched) {
        void CustomCommandManager.getInstance().recordUsage(expanded.matched);
      }
      const resolvedText =
        expanded.matched && settings.enableCustomPromptTemplating === false
          ? expanded.text
          : resolveActiveNoteToken(expanded.text, activeFile);

      const shouldIncludeActiveWebTab =
        includeActiveWebTab || resolvedText.includes(ACTIVE_WEB_TAB_MARKER);
      const resolvedWebTabs = buildWebTabsWithActiveSnapshot(
        app,
        webTabs ?? [],
        shouldIncludeActiveWebTab
      );

      // /compact drops attachments, so an image the model can't read must not block it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
      const images = isCompactCommand(resolvedText) ? [] : selectedImages;
      const commandImageModelLabel = unsupportedImageModelLabelFor(commandModelId);
      if (images.length > 0 && commandImageModelLabel) {
        new Notice(t("notice.imageModelUnsupported", { model: commandImageModelLabel }));
        return;
      }

      let mentionedAgents: ReadonlyArray<BackendId> | undefined;
      if (mainAgentId === "pi" && mentionedAgentIdsRef.current.length > 0) {
        try {
          mentionedAgents = resolveAnswererModels({
            mentionedModelKeys: mentionedAgentIdsRef.current,
            availableModels: availableFanoutModels,
          });
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error));
          return;
        }
      }

      mentionedAgentIdsRef.current = [];
      resetCompose();
      clearSelectedTextContexts();

      const content: PromptContent[] = [];
      for (const image of images) {
        const block = await fileToImageBlock(image);
        if (block) content.push(block);
      }

      // Failed image reads must not turn an image-only message into an empty request.
      // https://github.com/logancyang/obsidian-copilot/issues/2850
      if (images.length > 0 && !resolvedText && content.length === 0) {
        new Notice(t("notice.imagesUnreadable"));
        return;
      }

      const item: QueuedAgentMessage = {
        id: `queued-${uuidv4()}`,
        text: resolvedText,
        rawInput,
        context: buildMessageContext(notes, selectedTextContexts, resolvedWebTabs),
        promptContent: content.length > 0 ? content : undefined,
        mentionedAgents,
        commandModelId,
        commandContext: draft.commandContext,
      };

      if (loading || isStarting) {
        setQueuedMessages((q) => [...q, item]);
        return;
      }

      await runSend(item);
    },
    [
      app,
      plugin,
      draft.commandContext,
      settings.enableCustomPromptTemplating,
      inputMessage,
      selectedImages,
      contextNotes,
      includeActiveNote,
      includeActiveWebTab,
      selectedTextContexts,
      loading,
      isStarting,
      unsupportedImageModelLabelFor,
      disabled,
      resetCompose,
      runSend,
      setQueuedMessages,
      mainAgentId,
      availableFanoutModels,
    ]
  );

  useEffect(() => {
    if (disabled || loading || isStarting || queuedMessages.length === 0) return;
    const { batch, rest } = takeNextQueuedBatch(queuedMessages);
    const combined = combineQueuedMessages(batch);
    const imageModelLabel = unsupportedImageModelLabelFor(combined.commandModelId);
    if (combined.promptContent?.some((content) => content.type === "image") && imageModelLabel) {
      new Notice(t("notice.imageModelUnsupported", { model: imageModelLabel }));
      return;
    }
    setQueuedMessages(rest);
    void runSend(combined);
  }, [
    disabled,
    loading,
    isStarting,
    queuedMessages,
    runSend,
    setQueuedMessages,
    unsupportedImageModelLabelFor,
  ]);

  const [stoppingBackground, setStoppingBackground] = useState(false);
  const backgroundStopPending = useRef(false);
  const backgroundTaskCount = backend.getActiveBackgroundTaskCount?.() ?? 0;
  const stopBackgroundTasks = async () => {
    if (backgroundStopPending.current || backgroundTaskCount <= 0) return;
    backgroundStopPending.current = true;
    setStoppingBackground(true);
    try {
      await backend.cancel();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("agentChat.background.stopFailed"));
    } finally {
      backgroundStopPending.current = false;
      setStoppingBackground(false);
    }
  };

  const [steering, setSteering] = useState(false);
  const steerPending = useRef(false);
  const latestInput = useRef(inputMessage);
  latestInput.current = inputMessage;
  const pureSteerText =
    Boolean(inputMessage.trim()) &&
    !/^\s*\//.test(inputMessage) &&
    selectedImages.length === 0 &&
    contextNotes.length === 0 &&
    !includeActiveNote &&
    !includeActiveWebTab &&
    selectedTextContexts.length === 0 &&
    !draft.commandContext &&
    mentionedAgentIdsRef.current.length === 0;
  const submitSteer = async () => {
    if (
      !pureSteerText ||
      steerPending.current ||
      disabled ||
      hasPendingPlanPermission ||
      !backend.canSteer?.() ||
      !backend.steerMessage
    )
      return;
    const text = inputMessage;
    steerPending.current = true;
    setSteering(true);
    try {
      await backend.steerMessage(text);
      updateUserMessageHistory(text);
      if (latestInput.current === text) resetCompose();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "未补充，请重新发送。");
    } finally {
      steerPending.current = false;
      setSteering(false);
    }
  };

  const handleRemoveQueuedMessage = useCallback(
    (id: string) => {
      setQueuedMessages((q) => q.filter((m) => m.id !== id));
    },
    [setQueuedMessages]
  );

  useEffect(() => {
    const handleAbortStream = () => {
      void handleStopGenerating();
    };
    eventTarget?.addEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    return () => {
      eventTarget?.removeEventListener(EVENT_NAMES.ABORT_STREAM, handleAbortStream);
    };
  }, [eventTarget, handleStopGenerating]);

  return (
    <>
      {queuedMessages.length > 0 && (
        <QueuedMessageList messages={queuedMessages} onRemove={handleRemoveQueuedMessage} />
      )}
      {!loading && backgroundTaskCount > 0 && (
        <AgentBackgroundTaskAction
          count={backgroundTaskCount}
          pending={stoppingBackground}
          onStop={safeAsyncHandler(stopBackgroundTasks)}
        />
      )}
      {loading && backend.canSteer?.() && (
        <AgentSteerAction
          disabled={!pureSteerText || disabled || hasPendingPlanPermission}
          pending={steering}
          onSubmit={safeAsyncHandler(submitSteer)}
        />
      )}
      <div
        className={
          hasPendingPlanPermission || disabled ? "tw-pointer-events-none tw-opacity-50" : undefined
        }
        aria-disabled={hasPendingPlanPermission || disabled || undefined}
      >
        <ChatInput
          ref={chatInputRef}
          key={chatInputId}
          isAgentMode
          placeholder={t("home.placeholder")}
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          handleSendMessage={safeAsyncHandler((meta) => handleSendMessage(meta?.webTabs))}
          isGenerating={loading}
          onStopGenerating={safeAsyncHandler(handleStopGenerating)}
          onEscape={loading ? safeAsyncHandler(handleStopGenerating) : undefined}
          onShiftTab={modePickerOverride ? onCycleMode : undefined}
          app={app}
          contextNotes={contextNotes}
          setContextNotes={setContextNotes}
          includeActiveNote={includeActiveNote}
          setIncludeActiveNote={setIncludeActiveNote}
          includeActiveWebTab={includeActiveWebTab}
          setIncludeActiveWebTab={setIncludeActiveWebTab}
          activeWebTab={activeWebTabForMentions}
          selectedImages={selectedImages}
          onAddImage={addImages}
          setSelectedImages={setSelectedImages}
          disableModelSwitch={!modelPickerOverride}
          modelPickerOverride={modelPickerOverride ?? undefined}
          modePickerOverride={modePickerOverride ?? undefined}
          selectedTextContexts={selectedTextContexts}
          onRemoveSelectedText={removeSelectedTextContext}
          agentBrands={agentBrands}
          onMentionedAgentsChange={handleMentionedAgentsChange}
        />
      </div>
    </>
  );
});
