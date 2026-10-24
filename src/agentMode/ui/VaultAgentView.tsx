import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import { attachChatViewLayoutObservers } from "@/components/chat-components/attachChatViewLayoutObservers";
import { CHAT_AGENT_VIEWTYPE, VAULT_AGENT_ICON_ID } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import { t } from "@/i18n";
import VaultAgentPlugin from "@/main";
import { registerActiveLeafChangeBridge } from "@/utils/registerActiveLeafChangeBridge";
import { mountPluginViewRoot, type PluginViewRootHandle } from "@/utils/react/mountPluginViewRoot";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";

export default class VaultAgentView extends ItemView {
  private viewRoot: PluginViewRootHandle | null = null;
  private disposeLayoutObservers: (() => void) | null = null;
  eventTarget: ChatViewEventTarget;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: VaultAgentPlugin
  ) {
    super(leaf);
    this.app = plugin.app;
    this.eventTarget = new ChatViewEventTarget();
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_AGENT_VIEWTYPE;
  }

  getIcon(): string {
    return VAULT_AGENT_ICON_ID;
  }

  getTitle(): string {
    return t("app.view.agentChatTitle");
  }

  getDisplayText(): string {
    return t("app.view.agentChatDisplay");
  }

  async onOpen(): Promise<void> {
    this.viewRoot = mountPluginViewRoot(this.containerEl, this.app, () => this.renderTree());

    const observers = attachChatViewLayoutObservers(this.containerEl);
    this.disposeLayoutObservers = observers.dispose;

    registerActiveLeafChangeBridge(this, this.eventTarget);

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        window.requestAnimationFrame(() => observers.rebindDrawerObserver());
      })
    );
  }

  private renderTree(): React.ReactNode {
    return (
      <EventTargetContext.Provider value={this.eventTarget}>
        <Tooltip.Provider delayDuration={0}>
          <AgentModeChat
            plugin={this.plugin}
            updateUserMessageHistory={(msg) => this.plugin.updateUserMessageHistory(msg)}
          />
        </Tooltip.Provider>
      </EventTargetContext.Provider>
    );
  }

  updateView(): void {
    this.viewRoot?.rerender();
  }

  async onClose(): Promise<void> {
    this.disposeLayoutObservers?.();
    this.disposeLayoutObservers = null;

    this.viewRoot?.unmount();
    this.viewRoot = null;
  }
}
