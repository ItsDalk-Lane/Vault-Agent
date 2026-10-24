import type { AgentSessionManager, SkillManager } from "@/agentMode";
import { getSelectedTextContexts, setSelectedTextContexts } from "@/aiParams";
import { registerCommands } from "@/commands";
import type { CommandDraftContext } from "@/types/commandDraft";
import { registerEditorCommandMenu } from "@/commands/editorCommandMenu";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { StartupLoadingView, type VaultAgentStartup } from "@/components/StartupLoadingView";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import {
  AGENT_VIEW_TYPES,
  CHAT_AGENT_VIEWTYPE,
  VAULT_AGENT_ICON_ID,
  VAULT_AGENT_ICON_SVG,
  DEFAULT_OPEN_AREA,
  EVENT_NAMES,
  PLAN_PREVIEW_VIEW_TYPE,
  TURN_DIFF_VIEW_TYPE,
} from "@/constants";
import { ContextProcessor } from "@/contextProcessor";
import { applyLanguage, t } from "@/i18n";
import { logError, logFatalError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { createModelManagement, type ModelManagementApi } from "@/modelManagement";
import { ProjectRegister } from "@/projects/projectRegister";
import { KeychainService } from "@/services/keychainService";
import {
  flushPersistence,
  loadSettingsWithKeychain,
  persistSettings,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import {
  getWebViewerService,
  startActiveWebTabTracking,
} from "@/services/webViewerService/webViewerServiceSingleton";
import { WebSelectionTracker } from "@/services/webViewerService/webViewerServiceSelection";

import { getSettings, setSettings, subscribeToSettingsChange } from "@/settings/model";
import { VaultAgentSettingTab } from "@/settings/SettingsPage";
import type { NoteSelectedTextContext, SelectedTextContext } from "@/types/message";
import { withTimeout } from "@/utils";

import { buildChatDeepLink, buildChatMarkdownLink } from "@/utils/chatDeepLink";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import { disposeNotificationSound } from "@/utils/notificationSound";
import { installRendererEventsShim } from "@/utils/rendererEventsShim";
import { EditorView } from "@codemirror/view";
import {
  addIcon,
  editorInfoField,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  View,
  ViewCreator,
  WorkspaceLeaf,
} from "obsidian";
import { v4 as uuidv4 } from "uuid";

const PENDING_TEARDOWN = Symbol.for("vault-agent:pending-teardown");
const PREVIOUS_TEARDOWN_TIMEOUT_MS = 10_000;

interface TeardownHandoff {
  [PENDING_TEARDOWN]?: Promise<void>;
}

export default class VaultAgentPlugin extends Plugin implements VaultAgentStartup {
  modelManagement!: ModelManagementApi;
  agentSessionManager?: AgentSessionManager;
  skills?: SkillManager;
  settingsUnsubscriber?: () => void;
  userMessageHistory: string[] = [];
  customCommandRegister!: CustomCommandRegister;
  projectRegister!: ProjectRegister;
  private VaultAgentView?: typeof import("@/agentMode").VaultAgentView;
  private PlanPreviewView?: typeof import("@/agentMode").PlanPreviewView;
  private TurnDiffView?: typeof import("@/agentMode").TurnDiffView;
  private pluginLifecycleActive = true;
  private initialization: Promise<void> = Promise.resolve();
  private readonly startedViewCreators = new Map<string, ViewCreator>();
  private selectionDebounceTimer?: number;
  private lastSelectionSignature?: string;
  private webSelectionTracker?: WebSelectionTracker;

  public isPluginLifecycleActive(): boolean {
    return this.pluginLifecycleActive;
  }

  whenStarted(): Promise<void> {
    return this.initialization;
  }

  isStarted(): boolean {
    return this.pluginLifecycleActive && this.startedViewCreators.size > 0;
  }

  createStartedView(viewType: string, leaf: WorkspaceLeaf): View | undefined {
    if (!this.pluginLifecycleActive) return undefined;
    return this.startedViewCreators.get(viewType)?.(leaf);
  }

  // Obsidian awaits onload before opening the vault and never waits for it before unloading, so
  // startup work runs in the background and registers what needs loaded settings only after its
  // last await. https://github.com/logancyang/obsidian-copilot/issues/3518
  onload(): void {
    installRendererEventsShim();
    this.initialization = this.initialize().catch((error) => {
      // logError prints only when the debug setting is on, which a failed settings load never
      // reads, and this catch keeps Obsidian from logging the failure itself.
      // https://github.com/logancyang/obsidian-copilot/issues/3518
      logFatalError("Vault Agent failed to start.", error);
      new Notice(t("notice.startFailed"));
      // Obsidian keeps a plugin enabled when work after onload fails, so release whatever
      // startup registered before the failure. https://github.com/logancyang/obsidian-copilot/issues/3518
      this.unload();
    });
    // Restored tabs and the settings tab exist from the start so they show startup progress
    // instead of disappearing. https://github.com/logancyang/obsidian-copilot/issues/3518
    for (const viewType of AGENT_VIEW_TYPES) {
      this.safeRegisterView(
        viewType,
        (leaf: WorkspaceLeaf) =>
          this.createStartedView(viewType, leaf) ?? new StartupLoadingView(leaf, viewType, this)
      );
    }
    this.addSettingTab(new VaultAgentSettingTab(this.app, this));
    // Obsidian dispatches the URI that launched it once its layout loads, which can precede
    // initialization, so the handler exists from the start and waits for the chat managers.
    // https://github.com/logancyang/obsidian-copilot/issues/3271
    this.registerObsidianProtocolHandler("vault-agent", (params) => {
      void this.initialization.then(() => {
        if (this.pluginLifecycleActive) void this.openChatDeepLink(params);
      });
    });
  }

  private async initialize(): Promise<void> {
    await this.waitForPreviousTeardown();
    if (!this.pluginLifecycleActive) return;
    resetPersistenceState();
    KeychainService.resetInstance();
    KeychainService.getInstance(this.app);
    await this.loadSettings();
    if (!this.pluginLifecycleActive) return;
    const agentMode = isDesktopRuntime() ? await import("@/agentMode") : null;
    this.modelManagement = createModelManagement({
      app: this.app,
      resolveDeclaredModelCapabilities: agentMode?.lookupDeclaredModelCapabilities,
      testModelConnection: agentMode?.testModelConnection,
    });
    this.settingsUnsubscriber = subscribeToSettingsChange((prev, next) => {
      applyLanguage(next.language);
      void (async () => {
        try {
          await persistSettings(next, (data) => this.saveData(data), prev);
        } catch (error) {
          logError("Failed to persist settings.", error);
          new Notice(t("notice.saveSettingsFailed"));
        }
      })();
    });

    ContextProcessor.getInstance(this.app);
    CustomCommandManager.getInstance(this.app);

    if (agentMode) {
      const {
        VaultAgentView,
        PlanPreviewView,
        TurnDiffView,
        closeRestoredTurnDiffs,
        registerTurnDiffCommands,
        createAgentSessionManager,
        SkillManager,
      } = agentMode;
      this.VaultAgentView = VaultAgentView;
      this.PlanPreviewView = PlanPreviewView;
      this.TurnDiffView = TurnDiffView;
      closeRestoredTurnDiffs(this.app.workspace);
      registerTurnDiffCommands(this);

      this.agentSessionManager = createAgentSessionManager(this.app, this);
      this.skills = SkillManager.getInstance();
    }

    addIcon(VAULT_AGENT_ICON_ID, VAULT_AGENT_ICON_SVG);

    if (this.VaultAgentView && this.PlanPreviewView && this.TurnDiffView) {
      const AgentView = this.VaultAgentView;
      const PreviewView = this.PlanPreviewView;
      const DiffView = this.TurnDiffView;
      this.startedViewCreators.set(CHAT_AGENT_VIEWTYPE, (leaf) => new AgentView(leaf, this));
      this.startedViewCreators.set(PLAN_PREVIEW_VIEW_TYPE, (leaf) => new PreviewView(leaf));
      this.startedViewCreators.set(TURN_DIFF_VIEW_TYPE, (leaf) => new DiffView(leaf));
    }

    this.initActiveLeafChangeHandler();

    this.addRibbonIcon(
      VAULT_AGENT_ICON_ID,
      t("app.ribbon.openAgentChat"),
      () => void this.toggleAgentView()
    );

    if (isDesktopRuntime()) {
      const { activeLeafRef, layoutRef } = startActiveWebTabTracking(this.app, {
        preserveOnViewTypes: [CHAT_AGENT_VIEWTYPE],
      });
      this.registerEvent(activeLeafRef);
      this.registerEvent(layoutRef);
    }

    registerCommands(this);

    this.customCommandRegister = new CustomCommandRegister(this, this.app);
    this.projectRegister = new ProjectRegister(this.app);
    await this.projectRegister.initialize();
    await this.customCommandRegister.initialize();

    this.initSelectionHandler();
    registerEditorCommandMenu(this);
    this.initWebSelectionWatcher();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const activeViewType = leaf?.getViewState().type;
        if (activeViewType === CHAT_AGENT_VIEWTYPE) {
          this.emitChatIsVisible();
        }
      })
    );
  }

  // A disabled or updated copy may still be writing data.json or stopping Agent Mode backends;
  // a hung shutdown must not keep this copy, or any later one, from starting.
  // https://github.com/logancyang/obsidian-copilot/issues/3518
  private async waitForPreviousTeardown(): Promise<void> {
    const handoff = window as TeardownHandoff;
    const previousTeardown = handoff[PENDING_TEARDOWN];
    if (!previousTeardown) return;
    try {
      await withTimeout(
        () => previousTeardown,
        PREVIOUS_TEARDOWN_TIMEOUT_MS,
        "Previous Vault Agent shutdown"
      );
    } catch (error) {
      logWarn("Vault Agent started before its previous copy finished shutting down.", error);
    }
    if (handoff[PENDING_TEARDOWN] === previousTeardown) delete handoff[PENDING_TEARDOWN];
  }

  private safeRegisterView(type: string, viewCreator: ViewCreator): void {
    try {
      this.registerView(type, viewCreator);
    } catch (error) {
      logWarn(
        `Vault Agent: view type "${type}" already registered; skipping re-registration.`,
        error
      );
    }
  }

  onunload(): void {
    this.pluginLifecycleActive = false;
    // The audio module is shared across hot-reloaded plugin instances, so the outgoing
    // teardown must release its context before a successor can create one. https://github.com/logancyang/obsidian-copilot/issues/2987
    disposeNotificationSound();
    const handoff = window as TeardownHandoff;
    const teardown = this.teardown().catch((error) => {
      logError("Vault Agent: plugin teardown failed during unload:", error);
    });
    // A copy unloaded mid-startup tears down instantly while its own settings load, and its
    // startup still waits on any older copy's shutdown, so the handoff covers both.
    // https://github.com/logancyang/obsidian-copilot/issues/3518
    handoff[PENDING_TEARDOWN] = Promise.all([this.initialization, teardown]).then(() => undefined);
  }

  private async teardown(): Promise<void> {
    await this.agentSessionManager?.shutdown();

    this.customCommandRegister?.cleanup();
    this.projectRegister?.cleanup();
    // The handoff releases the next copy once teardown resolves, so the drain must come after
    // the last settings change can queue a write. https://github.com/logancyang/obsidian-copilot/issues/3518
    this.settingsUnsubscriber?.();
    await flushPersistence();

    if (isDesktopRuntime()) {
      const { SkillManager } = await import("@/agentMode");
      if (SkillManager.hasInstance()) {
        SkillManager.getInstance().dispose();
      }
    }

    window.clearTimeout(this.selectionDebounceTimer);
    this.cleanupWebSelectionWatcher();
    this.clearSelectionContext();

    try {
      const webViewerService = getWebViewerService(this.app);
      webViewerService.stopActiveWebTabTracking();
    } catch (error) {
      logWarn("Could not stop web tab tracking", error);
    }

    this.modelManagement?.dispose();

    await logFileManager.flush();
    logInfo("Vault Agent plugin unloaded");
  }

  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  emitChatIsVisible() {
    const view = this.app.workspace
      .getLeavesOfType(CHAT_AGENT_VIEWTYPE)
      .map((leaf) => leaf.view)
      .find((v) => this.isVaultAgentView(v));

    if (view) {
      view.eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE));
    }
  }

  initActiveLeafChangeHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        if (leaf.getViewState().type === CHAT_AGENT_VIEWTYPE) {
          this.emitChatIsVisible();
        }
      })
    );
  }

  initSelectionHandler() {
    this.registerEditorExtension(
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet || !update.view.hasFocus) return;

        // The originating editor identifies its note even in a popout, where
        // the active leaf may differ. https://github.com/Brevilabs/obsidian-copilot-private/issues/597
        const info = update.state.field(editorInfoField, false);
        if (info) this.scheduleSelectionUpdate(() => this.handleSelectionChange(info));
      })
    );

    const watchDocument = (doc: Document) =>
      this.registerDomEvent(doc, "selectionchange", () => this.handleReadingSelectionChange(doc));
    watchDocument(activeDocument);
    this.registerEvent(this.app.workspace.on("window-open", (win) => watchDocument(win.doc)));
  }

  private scheduleSelectionUpdate(update: () => void): void {
    window.clearTimeout(this.selectionDebounceTimer);
    this.selectionDebounceTimer = window.setTimeout(update, 500);
  }

  private handleReadingSelectionChange(doc: Document): void {
    const selection = doc.getSelection();
    const anchor = selection?.anchorNode;
    const focus = selection?.focusNode;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!anchor || !focus || !file || view.getMode() !== "preview") return;

    // Only rendered text inside the note is a note selection; a later chat
    // selection leaves the pending one attached. https://github.com/Brevilabs/obsidian-copilot-private/issues/597
    const readingEl = view.previewMode.containerEl;
    if (!readingEl.contains(anchor) || !readingEl.contains(focus)) return;

    const selectedText = selection.toString();
    this.scheduleSelectionUpdate(() => {
      const signature = `preview:${file.path}:${selectedText}`;
      if (signature === this.lastSelectionSignature) return;
      this.lastSelectionSignature = signature;

      if (!selectedText.trim()) {
        this.clearNoteSelectionContexts();
        return;
      }

      // Rendered Markdown does not expose reliable source line numbers for every selection.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/597
      this.setSelectionContext({
        id: uuidv4(),
        content: selectedText,
        sourceType: "note",
        noteTitle: file.basename,
        notePath: file.path,
        startLine: 0,
        endLine: 0,
      });
    });
  }

  private clearNoteSelectionContexts(): void {
    const currentContexts = getSelectedTextContexts();
    const nonNoteContexts = currentContexts.filter((ctx) => ctx.sourceType !== "note");
    if (currentContexts.length !== nonNoteContexts.length) {
      setSelectedTextContexts(nonNoteContexts);
    }
  }

  private clearSelectionContext() {
    setSelectedTextContexts([]);
  }

  private clearWebSelectionContextForUrl(url: string): void {
    const current = getSelectedTextContexts();
    const next = current.filter((c) => c.sourceType !== "web" || c.url !== url);
    if (next.length === current.length) {
      return;
    }
    setSelectedTextContexts(next);
  }

  private setSelectionContext(context: SelectedTextContext) {
    setSelectedTextContexts([context]);
  }

  handleSelectionChange({ editor, file }: MarkdownFileInfo) {
    const selectionRange = editor?.listSelections()[0];
    if (!editor || !selectionRange) {
      return;
    }

    const signature = file
      ? `${file.path}:${selectionRange.anchor.line}:${selectionRange.anchor.ch}:${selectionRange.head.line}:${selectionRange.head.ch}`
      : "";

    if (signature === this.lastSelectionSignature) {
      return;
    }
    this.lastSelectionSignature = signature;

    const selectedText = editor.getSelection();

    if (!selectedText || !selectedText.trim()) {
      this.clearNoteSelectionContexts();
      return;
    }

    if (!file) {
      return;
    }

    const anchorLine = selectionRange.anchor.line + 1;
    const headLine = selectionRange.head.line + 1;
    const startLine = Math.min(anchorLine, headLine);
    const endLine = Math.max(anchorLine, headLine);

    const selectedTextContext: NoteSelectedTextContext = {
      id: uuidv4(),
      content: selectedText,
      sourceType: "note",
      noteTitle: file.basename,
      notePath: file.path,
      startLine,
      endLine,
    };

    this.setSelectionContext(selectedTextContext);
  }

  initWebSelectionWatcher() {
    if (!isDesktopRuntime()) {
      return;
    }

    const webViewerService = getWebViewerService(this.app);

    this.webSelectionTracker = new WebSelectionTracker({
      intervalMs: 500,
      emptySelectionDebounceCount: 2,
      isEnabled: () => true,
      getLeaf: () => webViewerService.getActiveLeaf() ?? webViewerService.getLastActiveLeaf(),
      getActiveLeaf: () => webViewerService.getActiveLeaf(),
      onSelectionChange: (context) => {
        this.setSelectionContext(context);
      },
      onSelectionClear: ({ url }) => {
        this.clearWebSelectionContextForUrl(url);
      },
    });

    this.webSelectionTracker.start();
  }

  cleanupWebSelectionWatcher() {
    this.webSelectionTracker?.stop();
    this.webSelectionTracker = undefined;
  }

  toggleAgentView() {
    if (!this.requireAgentView()) return;
    const leaves = this.app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE);
    if (leaves.length > 0) {
      void this.deactivateAgentView();
    } else {
      void this.activateAgentView();
    }
  }

  async activateAgentView(openInRightSidebar = false): Promise<WorkspaceLeaf | null> {
    if (!this.requireAgentView()) return null;
    const leaf = await this.openOrRevealView(CHAT_AGENT_VIEWTYPE, openInRightSidebar);
    const view = leaf?.view;
    if (this.isVaultAgentView(view)) {
      view.eventTarget.queueVisible();
    }
    return leaf;
  }

  async addNoteToAgentChat(note: TFile, openInRightSidebar = false): Promise<void> {
    try {
      const leaf = await this.activateAgentView(openInRightSidebar);
      if (!leaf) return;
      await this.agentSessionManager?.addContextNoteToActiveChat(note);
    } catch (error) {
      logError("Failed to add a note to Agent Chat.", error);
      new Notice(t("notice.addNoteFailed"));
    }
  }

  async deactivateAgentView() {
    this.app.workspace.detachLeavesOfType(CHAT_AGENT_VIEWTYPE);
  }

  async addNoteToActiveChat(note: TFile): Promise<void> {
    await this.addNoteToAgentChat(note);
  }

  async newAgentChat(): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    await this.activateAgentView();
    try {
      await manager.createSession();
    } catch (error) {
      logWarn("[VaultAgentPlugin] Failed to create agent session", error);
      new Notice(t("notice.createSessionFailed"));
    }
  }

  async newAgentChatWithDraft(
    initialDraft: string,
    commandContext?: CommandDraftContext
  ): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    try {
      await manager.createGlobalSessionWithDraft(initialDraft, commandContext);
      await this.activateAgentView();
    } catch (error) {
      logWarn("[VaultAgentPlugin] Failed to create agent session with draft", error);
      new Notice(t("notice.createSessionFailed"));
    }
  }

  private async openOrRevealView(
    viewType: string,
    openInRightSidebar = false
  ): Promise<WorkspaceLeaf | null> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return leaves[0];
    }
    const leaf =
      openInRightSidebar || getSettings().defaultOpenArea === DEFAULT_OPEN_AREA.VIEW
        ? this.app.workspace.getRightLeaf(false)
        : this.app.workspace.getLeaf(true);
    if (!leaf) return null;
    await leaf.setViewState({ type: viewType, active: true });
    // A new right-sidebar leaf can exist while the sidebar remains collapsed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
    if (openInRightSidebar) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private requireAgentView(): AgentSessionManager | null {
    if (!isDesktopRuntime()) {
      new Notice(t("notice.notDesktop"));
      return null;
    }
    if (!this.agentSessionManager) {
      new Notice(t("notice.agentNotReady"));
      return null;
    }
    return this.agentSessionManager;
  }

  private isVaultAgentView(
    view: unknown
  ): view is InstanceType<NonNullable<typeof this.VaultAgentView>> {
    const AgentView = this.VaultAgentView;
    return !!AgentView && view instanceof AgentView;
  }

  async loadSettings() {
    const rawData = (await this.loadData()) as unknown;
    const settings = await loadSettingsWithKeychain(rawData, (data) => this.saveData(data));
    setSettings(settings);
    applyLanguage(getSettings().language);
  }

  async getChatHistoryItems(): Promise<ChatHistoryItem[]> {
    return this.agentSessionManager?.getChatHistoryItems() ?? [];
  }

  async loadChatById(id: string): Promise<void> {
    if (!isNativeChatId(id)) throw new Error(t("notice.linkNotFound"));
    await this.loadNativeAgentChat(id);
  }

  async copyChatLink(resolveSession: () => Promise<string>): Promise<void> {
    try {
      const id = await resolveSession();
      if (!isNativeChatId(id)) throw new Error(t("notice.linkNotFound"));
      const title =
        this.agentSessionManager?.getSessionByBackendId(id)?.getLabel() ??
        (await this.agentSessionManager?.getChatHistoryItems())?.find((item) => item.id === id)
          ?.title ??
        t("agentInfra.session.untitledChat");
      await navigator.clipboard.writeText(
        buildChatMarkdownLink(title, buildChatDeepLink(this.app.vault.getName(), id))
      );
      new Notice(t("notice.linkCopied"));
    } catch (error) {
      logError("Failed to copy chat link", error);
      new Notice(t("notice.linkCopyFailed"));
    }
  }

  async openChatDeepLink(params: Record<string, string>): Promise<void> {
    try {
      await this.loadChatById(params.id ?? "");
    } catch (error) {
      logError("Failed to open chat link", error);
      new Notice(
        t(
          (error as { code?: unknown } | null | undefined)?.code === "SESSION_NOT_FOUND"
            ? "localData.sessionMissing"
            : "notice.linkNotFound"
        )
      );
    }
  }

  private async loadNativeAgentChat(chatId: string): Promise<void> {
    const ref = parseNativeChatId(chatId);
    if (!ref) throw new Error("Chat not found.");
    const manager = this.requireAgentView();
    if (!manager) return;
    const leaf = await this.activateAgentView();
    if (!leaf) return;

    await manager.loadNativeSessionFromHistory(ref.backendId, ref.sessionId);

    if (this.isVaultAgentView(leaf.view)) {
      leaf.view.updateView();
    }
  }
}
