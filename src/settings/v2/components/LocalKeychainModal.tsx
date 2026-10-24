import { App, Modal } from "obsidian";
import React from "react";
import { t } from "@/i18n";
import type { LocalKeychainEntryDetail } from "@/services/localDataStatus";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { Root } from "react-dom/client";

function formatStoredAt(createdAt: number | undefined): string {
  if (createdAt === undefined) return t("localData.storedAtUnknown");
  const date = new Date(createdAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
  return t("localData.storedAt", { time });
}

export interface LocalKeychainDetailContentProps {
  groupLabel: string;
  entries: readonly LocalKeychainEntryDetail[];
  unreferencedOnly?: boolean;
}

export function LocalKeychainDetailContent({
  groupLabel,
  entries,
  unreferencedOnly,
}: LocalKeychainDetailContentProps) {
  return (
    <div>
      <div className="tw-mb-2 tw-min-w-0">
        <span className="tw-block tw-truncate tw-text-base tw-font-semibold tw-text-normal">
          {t("localData.keychainDetailTitle", { label: groupLabel, count: entries.length })}
        </span>
      </div>
      <div className="tw-divide-y tw-divide-border">
        {entries.map((entry) => (
          <div key={entry.id} className="tw-min-w-0 tw-px-4 tw-py-2 first:tw-pt-1">
            <div className="tw-flex tw-min-w-0 tw-items-baseline tw-justify-between tw-gap-3">
              <span
                className="tw-min-w-0 tw-truncate tw-text-sm tw-font-medium tw-text-normal"
                title={entry.label}
              >
                {entry.label ?? t("localData.unrecognized")}
              </span>
              <span className="tw-shrink-0 tw-text-xs tw-text-muted">
                {formatStoredAt(entry.createdAt)}
              </span>
            </div>
            <code
              className="tw-block tw-truncate tw-font-mono tw-text-xs tw-text-faint"
              title={entry.id}
            >
              {entry.id}
            </code>
          </div>
        ))}
      </div>
      <p className="tw-mt-3 tw-text-xs tw-leading-relaxed tw-text-faint">
        {unreferencedOnly
          ? t("localData.keychainModalFootOther")
          : t("localData.keychainModalFoot")}
      </p>
    </div>
  );
}

export interface LocalKeychainDetailModalOptions {
  app: App;
  groupLabel: string;
  entries: readonly LocalKeychainEntryDetail[];
  unreferencedOnly?: boolean;
}

// 关闭交给 Obsidian 模态自带的按钮与 Esc，这里不再渲染第二个关闭控件。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/8
export class LocalKeychainDetailModal extends Modal {
  private readonly options: LocalKeychainDetailModalOptions;
  private root: Root | null = null;

  constructor(options: LocalKeychainDetailModalOptions) {
    super(options.app);
    this.options = options;
  }

  onOpen() {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <LocalKeychainDetailContent
        groupLabel={this.options.groupLabel}
        entries={this.options.entries}
        unreferencedOnly={this.options.unreferencedOnly}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
