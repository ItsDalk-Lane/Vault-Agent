import { t } from "@/i18n";
import { logError } from "@/logger";
import { ItemView, type View, type WorkspaceLeaf } from "obsidian";

export const STARTUP_LOADING_TEXT = "Starting Vault Agent…";

export interface VaultAgentStartup {
  whenStarted(): Promise<void>;
  createStartedView(viewType: string, leaf: WorkspaceLeaf): View | undefined;
}

// 后台启动时保留恢复中的标签，避免被误认为插件失效而关闭。https://github.com/logancyang/obsidian-copilot/issues/3518
export class StartupLoadingView extends ItemView {
  private savedState: Record<string, unknown> = {};

  constructor(
    leaf: WorkspaceLeaf,
    private readonly viewType: string,
    private readonly startup: VaultAgentStartup
  ) {
    super(leaf);
  }

  getViewType(): string {
    return this.viewType;
  }

  getDisplayText(): string {
    return "Vault Agent";
  }

  getIcon(): string {
    return "message-square";
  }

  getState(): Record<string, unknown> {
    return this.savedState;
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    this.savedState = state;
  }

  async onOpen(): Promise<void> {
    this.contentEl.createDiv({
      cls: "tw-flex tw-size-full tw-items-center tw-justify-center tw-text-muted",
      text: t("ui.startup.loading"),
    });
    void this.replaceOnceStarted().catch((error) => {
      logError("Vault Agent could not open a tab restored during startup.", error);
    });
  }

  private async replaceOnceStarted(): Promise<void> {
    await this.startup.whenStarted();
    // 启动期间标签可能已关闭或换用，不能覆盖新的页面。https://github.com/logancyang/obsidian-copilot/issues/3518
    if (this.leaf.view !== this) return;
    const view = this.startup.createStartedView(this.viewType, this.leaf);
    if (!view) return;
    await this.leaf.open(view);
    await view.setState(this.savedState, { history: false });
  }
}
