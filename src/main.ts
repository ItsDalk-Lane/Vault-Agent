import type { AgentSessionManager, SkillManager } from "@/agentMode";
import { getSelectedTextContexts, setSelectedTextContexts } from "@/aiParams";
import { registerCommands } from "@/commands";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { StartupLoadingView, type VaultAgentStartup } from "@/components/StartupLoadingView";
import { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import {
  AGENT_CHAT_MODE,
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
import { createSelfHostWebSearchAgentBridge } from "@/LLMProviders/selfHostServices";
import type { SelfHostWebSearchAgentBridge } from "@/LLMProviders/selfHostServices";
import { logError, logFatalError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { createModelManagement, type ModelManagementApi } from "@/modelManagement";
import { ProjectRegister } from "@/projects/projectRegister";
import { KeychainService } from "@/services/keychainService";
import { backupLegacyCredentials } from "@/services/legacyCredentialBackup";
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
import { getEffectiveConversationsFolder } from "@/settings/vaultAgentFolder";
import { dehydrateDeviceProfile, hydrateDeviceProfile } from "@/settings/deviceProfiles";
import {
  type VaultAgentSettings,
  getSettings,
  setSettings,
  subscribeToSettingsChange,
} from "@/settings/model";
import { VaultAgentSettingTab } from "@/settings/SettingsPage";
import { SystemPromptRegister } from "@/system-prompts/systemPromptRegister";
import type { NoteSelectedTextContext, SelectedTextContext } from "@/types/message";
import { withTimeout } from "@/utils";
import {
  extractChatLastAccessedAtMs,
  extractChatTitle,
  fileToHistoryItem,
  filterChatHistoryFiles,
} from "@/utils/chatHistoryUtils";
import {
  buildChatDeepLink,
  buildChatMarkdownLink,
  findChatFileByDeepLinkId,
  getSavedChatDeepLinkId,
} from "@/utils/chatDeepLink";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { getDeviceId } from "@/utils/deviceId";
import { isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import { disposeNotificationSound } from "@/utils/notificationSound";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { installRendererEventsShim } from "@/utils/rendererEventsShim";
import { listMarkdownFiles, readFrontmatterViaAdapter, trashFile } from "@/utils/vaultAdapterUtils";
import { EditorView } from "@codemirror/view";
import {
  addIcon,
  editorInfoField,
  FileSystemAdapter,
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
  selfHostWebSearchAgentBridge?: Readonly<SelfHostWebSearchAgentBridge>;
  settingsUnsubscriber?: () => void;
  userMessageHistory: string[] = [];
  customCommandRegister!: CustomCommandRegister;
  systemPromptRegister!: SystemPromptRegister;
  projectRegister!: ProjectRegister;
  private VaultAgentView?: typeof import("@/agentMode").VaultAgentView;
  private PlanPreviewView?: typeof import("@/agentMode").PlanPreviewView;
  private TurnDiffView?: typeof import("@/agentMode").TurnDiffView;
  private agentModelDiscoveryUnsubscriber?: () => void;
  private readonly chatHistoryLastAccessedAtManager = new RecentUsageManager<string>();
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
      new Notice("Vault Agent failed to start. Check the console for details.");
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
    this.modelManagement = createModelManagement({
      app: this.app,
    });
    this.settingsUnsubscriber = subscribeToSettingsChange((prev, next) => {
      void (async () => {
        try {
          await persistSettings(next, (data) => this.saveData(data), prev);
        } catch (error) {
          logError("Failed to persist settings.", error);
          new Notice("Vault Agent failed to save settings. Check logs and try again.");
        }
      })();
    });
    const agentMode = isDesktopRuntime()
      ? await Promise.all([import("@/agentMode"), import("@/agentMode/agentModelDiscovery")])
      : null;

    ContextProcessor.getInstance(this.app);
    CustomCommandManager.getInstance(this.app);
    logFileManager.setApp(this.app);

    // Must precede Agent Chat: startup model discovery may spawn OpenCode.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/165
    const selfHostWebSearchAgentBridge = createSelfHostWebSearchAgentBridge();
    this.selfHostWebSearchAgentBridge = selfHostWebSearchAgentBridge;
    this.register(() => {
      selfHostWebSearchAgentBridge.dispose();
      if (this.selfHostWebSearchAgentBridge === selfHostWebSearchAgentBridge) {
        this.selfHostWebSearchAgentBridge = undefined;
      }
    });

    if (agentMode) {
      const [
        {
          VaultAgentView,
          PlanPreviewView,
          TurnDiffView,
          closeRestoredTurnDiffs,
          registerTurnDiffCommands,
          acpFrameSink,
          createAgentSessionManager,
          setFrameSinkVaultBasePath,
          SkillManager,
        },
        { wireAgentModelDiscovery },
      ] = agentMode;
      this.VaultAgentView = VaultAgentView;
      this.PlanPreviewView = PlanPreviewView;
      this.TurnDiffView = TurnDiffView;
      closeRestoredTurnDiffs(this.app.workspace);
      registerTurnDiffCommands(this);

      const adapter = this.app.vault.adapter;
      setFrameSinkVaultBasePath(
        adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null
      );
      // A log left permissive by an older build is only reachable here when
      // frame logging is off. https://github.com/logancyang/obsidian-copilot-preview/issues/250
      void acpFrameSink.narrowLegacyLogs();

      this.agentSessionManager = createAgentSessionManager(this.app, this);
      this.skills = SkillManager.getInstance();
      this.agentModelDiscoveryUnsubscriber = wireAgentModelDiscovery(
        this,
        this.agentSessionManager
      );
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

    this.addRibbonIcon(VAULT_AGENT_ICON_ID, "Open Agent Chat", () => void this.toggleAgentView());

    if (isDesktopRuntime()) {
      const { activeLeafRef, layoutRef } = startActiveWebTabTracking(this.app, {
        preserveOnViewTypes: [CHAT_AGENT_VIEWTYPE],
      });
      this.registerEvent(activeLeafRef);
      this.registerEvent(layoutRef);
    }

    registerCommands(this);

    this.customCommandRegister = new CustomCommandRegister(this, this.app);
    this.systemPromptRegister = new SystemPromptRegister(this.app);
    this.projectRegister = new ProjectRegister(this.app);
    await this.projectRegister.initialize();
    await this.customCommandRegister.initialize();
    await this.systemPromptRegister.initialize();

    this.initSelectionHandler();
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
    this.agentModelDiscoveryUnsubscriber?.();
    await this.agentSessionManager?.shutdown();

    this.customCommandRegister?.cleanup();
    this.systemPromptRegister?.cleanup();
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
      new Notice("Could not add the note to Agent Chat. Check Vault Agent logs.");
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
      new Notice("Failed to create agent session. Check Vault Agent logs.");
    }
  }

  async newAgentChatWithDraft(initialDraft: string): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    try {
      await manager.createGlobalSessionWithDraft(initialDraft);
      await this.activateAgentView();
    } catch (error) {
      logWarn("[VaultAgentPlugin] Failed to create agent session with draft", error);
      new Notice("Failed to create agent session. Check Vault Agent logs.");
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
      new Notice("Agent Chat is not available on mobile.");
      return null;
    }
    if (!this.agentSessionManager) {
      new Notice("Agent Chat is not initialized.");
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
    // The keychain bootstrap may persist a sparse snapshot of the raw on-disk
    // data (vaultId backfill) before settings are hydrated. That snapshot is
    // already in dehydrated, on-disk shape, so it must bypass the
    // `dehydrateDeviceProfile` override below via `super.saveData` — routing it
    // through `this.saveData` would read the absent flat fields as "cleared"
    // and delete this device's `deviceProfiles` segment
    // (https://github.com/logancyang/obsidian-copilot/issues/2539).
    const settings = await loadSettingsWithKeychain(
      this.app,
      rawData,
      (d) => super.saveData(d),
      (raw) =>
        backupLegacyCredentials(raw, this.manifest.dir ?? "", {
          exists: (path) => this.app.vault.adapter.exists(path),
          write: (path, contents) => this.app.vault.adapter.write(path, contents),
          rename: (from, to) => this.app.vault.adapter.rename(from, to),
        })
    );
    setSettings(hydrateDeviceProfile(settings, getDeviceId(this.app)));
  }

  // Single choke point for persisted writes; the load-time keychain bootstrap bypasses it via
  // `super.saveData` (see `loadSettings`).
  // https://github.com/logancyang/obsidian-copilot/issues/2539
  async saveData(data: unknown): Promise<void> {
    return super.saveData(
      dehydrateDeviceProfile(data as VaultAgentSettings, getDeviceId(this.app))
    );
  }

  async getChatHistoryFiles(): Promise<TFile[]> {
    const folderFiles = listMarkdownFiles(this.app, getEffectiveConversationsFolder());
    if (folderFiles.length === 0) return [];

    return filterChatHistoryFiles(this.app, folderFiles);
  }

  async getChatHistoryItems(): Promise<ChatHistoryItem[]> {
    const files = await this.getChatHistoryFiles();
    return files.map((file) =>
      fileToHistoryItem(this.app, file, this.chatHistoryLastAccessedAtManager)
    );
  }

  private async touchChatHistoryLastAccessedAt(file: TFile): Promise<void> {
    try {
      this.chatHistoryLastAccessedAtManager.touch(file.path);

      const persistedLastAccessedAtMs = extractChatLastAccessedAtMs(this.app, file);
      const timestampToPersist = this.chatHistoryLastAccessedAtManager.shouldPersist(
        file.path,
        persistedLastAccessedAtMs
      );

      if (timestampToPersist === null) {
        return;
      }

      let persistedAtMs = timestampToPersist;

      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          const existingValue = Number(frontmatter.lastAccessedAt);
          const existingAtMs =
            Number.isFinite(existingValue) && existingValue > 0 ? existingValue : 0;

          persistedAtMs = Math.max(existingAtMs, timestampToPersist);

          if (existingAtMs === persistedAtMs) {
            return;
          }

          frontmatter.lastAccessedAt = persistedAtMs;
        }
      );

      this.chatHistoryLastAccessedAtManager.markPersisted(file.path, persistedAtMs);
    } catch (error) {
      logWarn(`[VaultAgentPlugin] Failed to update chat lastAccessedAt for ${file.path}`, error);
    }
  }

  getChatHistoryLastAccessedAtManager(): RecentUsageManager<string> {
    return this.chatHistoryLastAccessedAtManager;
  }

  async loadChatById(fileId: string): Promise<void> {
    if (isNativeChatId(fileId)) {
      await this.loadNativeAgentChat(fileId);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (!(file instanceof TFile)) throw new Error("Chat file not found.");

    const cachedMode = this.app.metadataCache.getFileCache(file)?.frontmatter?.mode;
    let mode = typeof cachedMode === "string" ? cachedMode : undefined;
    if (!mode) {
      try {
        const fm = await readFrontmatterViaAdapter(this.app, file.path);
        if (typeof fm?.mode === "string") mode = fm.mode;
      } catch (error) {
        logWarn("Could not read the chat mode from frontmatter", error);
      }
    }
    if (mode !== AGENT_CHAT_MODE) {
      new Notice("This note is not an Agent chat.");
      return;
    }
    await this.loadAgentChatHistory(file);
  }

  async copyChatLink(resolveNotePath: () => Promise<string>): Promise<void> {
    try {
      const path = await resolveNotePath();
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      const id = file instanceof TFile ? await getSavedChatDeepLinkId(this.app, file.path) : null;
      if (!(file instanceof TFile) || !id) throw new Error(`No saved chat note to link: "${path}"`);
      const url = buildChatDeepLink(this.app.vault.getName(), id);
      await navigator.clipboard.writeText(
        buildChatMarkdownLink(extractChatTitle(this.app, file), url)
      );
      new Notice("Chat link copied.");
    } catch (error) {
      logError("Failed to copy chat link", error);
      new Notice("Could not copy chat link.");
    }
  }

  async openChatDeepLink(params: Record<string, string>): Promise<void> {
    const id = params.id ?? "";
    try {
      const chatId = isNativeChatId(id) ? id : (await findChatFileByDeepLinkId(this.app, id))?.path;
      if (!chatId) {
        new Notice("Chat link not found.");
        return;
      }
      await this.loadChatById(chatId);
    } catch (error) {
      logError("Failed to open chat link", error);
      new Notice("Could not open chat link.");
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

  private async loadAgentChatHistory(file: TFile): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    const leaf = await this.activateAgentView();
    if (!leaf) return;

    await manager.loadSessionFromHistory(file);
    void this.touchChatHistoryLastAccessedAt(file);

    if (this.isVaultAgentView(leaf.view)) {
      leaf.view.updateView();
    }
  }

  async openChatSourceFile(fileId: string): Promise<void> {
    if (isNativeChatId(fileId)) {
      new Notice(
        "This chat has no saved note. Turn on Autosave Chat as Markdown to save chats as notes in your vault."
      );
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          frontmatter.topic = newTitle;
        }
      );

      await new Promise<void>((resolve) => {
        const handler = (updatedFile: TFile) => {
          if (updatedFile.path === fileId) {
            this.app.metadataCache.off("changed", handler);
            window.clearTimeout(timeoutId);
            resolve();
          }
        };

        this.app.metadataCache.on("changed", handler);

        const timeoutId = window.setTimeout(() => {
          this.app.metadataCache.off("changed", handler);
          resolve();
        }, 500);
      });

      new Notice("Chat title updated.");
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async deleteChatHistory(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await trashFile(this.app, file);
      new Notice("Chat deleted.");
    } else {
      throw new Error("Chat file not found.");
    }
  }
}
