import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import { t } from "@/i18n";

interface ConfirmModalContentProps {
  content: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmButtonText: string;
  cancelButtonText: string;
  destructive: boolean;
}

function ConfirmModalContent({
  content,
  onConfirm,
  onCancel,
  confirmButtonText,
  cancelButtonText,
  destructive,
}: ConfirmModalContentProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-5">
      <div className="tw-whitespace-pre-wrap">{content}</div>
      <div className="tw-flex tw-justify-end tw-gap-2">
        {cancelButtonText && (
          <Button variant="secondary" onClick={onCancel} autoFocus={destructive}>
            {cancelButtonText}
          </Button>
        )}
        {confirmButtonText && (
          <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmButtonText}
          </Button>
        )}
      </div>
    </div>
  );
}

export class ConfirmModal extends Modal {
  private root: Root;
  private confirmed = false;

  constructor(
    app: App,
    private onConfirm: () => void | Promise<void>,
    private content: React.ReactNode,
    title: string,
    private confirmButtonText: string = t("ui.confirm.continue"),
    private cancelButtonText: string = t("common.cancel"),
    private onCancel?: () => void | Promise<void>,
    // 永久删除必须先落在取消按钮，普通确认仍保持原有默认行为。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    private destructive = false
  ) {
    super(app);
    // @ts-ignore
    this.setTitle(title);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createPluginRoot(contentEl, this.app);

    const handleConfirm = () => {
      this.confirmed = true;
      const result = this.onConfirm();
      if (result instanceof Promise) {
        result.catch((err) => logError("ConfirmModal onConfirm failed", err));
      }
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    this.root.render(
      <ConfirmModalContent
        content={this.content}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        confirmButtonText={this.confirmButtonText}
        cancelButtonText={this.cancelButtonText}
        destructive={this.destructive}
      />
    );
  }

  onClose() {
    if (!this.confirmed) {
      const result = this.onCancel?.();
      if (result instanceof Promise) {
        result.catch((err) => logError("ConfirmModal onCancel failed", err));
      }
    }
    this.root.unmount();
  }
}
