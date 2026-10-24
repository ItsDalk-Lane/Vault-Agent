import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { LocalDataStatus, LocalKeychainEntryDetail } from "@/services/localDataStatus";
import React, { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { FolderOpen, RefreshCw, Copy, ChevronDown } from "lucide-react";
import type { LocalDataTreeNodeData } from "./localDataTree";

export type LocalDataKeychainGroupKey = "providers" | "mcp" | "other";

export interface LocalDataKeychainGroup {
  key: LocalDataKeychainGroupKey;
  label: string;
  entries: readonly LocalKeychainEntryDetail[];
}

export interface LocalDataPanelProps {
  status: LocalDataStatus | null;
  tree: readonly LocalDataTreeNodeData[];
  loading: boolean;
  error?: string;
  keychainGroups: readonly LocalDataKeychainGroup[] | null;
  credentialsError?: string;
  settingsFileNote: string;
  onRefresh: () => void;
  onCopy: (path: string) => void;
  onReveal: (path: string) => void;
  onOpenKeychainGroup: (key: LocalDataKeychainGroupKey) => void;
}

export function formatLocalBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}

function formatShare(bytes: number, total: number): string {
  if (total <= 0 || bytes <= 0) return "";
  const share = (bytes / total) * 100;
  return share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`;
}

const EMPTY_OVERRIDES: Readonly<Record<string, boolean>> = Object.freeze({});

interface TreeRowProps {
  node: LocalDataTreeNodeData;
  expanded: boolean;
  onToggle: (id: string, next: boolean) => void;
  onCopy: LocalDataPanelProps["onCopy"];
  onReveal: LocalDataPanelProps["onReveal"];
}

function LocalDataTreeRow({ node, expanded, onToggle, onCopy, onReveal }: TreeRowProps) {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const sizeText = node.size === null ? "—" : formatLocalBytes(node.size);
  return (
    <div
      className={cn(
        "tw-group tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-py-1.5 tw-pl-2.5 tw-pr-3",
        node.id === "root" && "tw-py-2"
      )}
    >
      {hasChildren ? (
        <button
          type="button"
          className="tw-flex tw-size-5 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-p-0 tw-text-faint hover:tw-bg-modifier-hover hover:tw-text-normal"
          aria-expanded={expanded}
          aria-label={t("localData.toggleNode", { name: node.name })}
          onClick={() => onToggle(node.id, !expanded)}
        >
          <ChevronDown
            className={cn("tw-size-3.5 tw-transition-transform", !expanded && "-tw-rotate-90")}
          />
        </button>
      ) : (
        <span className="tw-inline-block tw-size-5 tw-shrink-0" />
      )}
      {node.badge === "private" && (
        <span className="tw-shrink-0 tw-rounded-full tw-bg-secondary tw-px-2 tw-text-xs tw-leading-5 tw-text-accent">
          {t("localData.badgePrivate")}
        </span>
      )}
      <span
        className={cn(
          "tw-min-w-0 tw-shrink tw-truncate tw-font-mono tw-text-xs tw-text-normal",
          node.id === "root" && "tw-font-medium"
        )}
        title={node.nameTooltip}
      >
        {node.name}
      </span>
      {node.detail !== undefined && (
        <span className="tw-hidden tw-min-w-0 tw-shrink-0 tw-truncate tw-font-mono tw-text-xs tw-text-faint md:tw-block">
          {node.detail}
        </span>
      )}
      {node.note !== undefined && (
        <span
          className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-xs tw-text-muted"
          title={node.note}
        >
          {node.note}
        </span>
      )}
      <span
        className={cn(
          "tw-shrink-0 tw-text-xs tw-tabular-nums",
          node.size === null || node.size === 0 ? "tw-text-faint" : "tw-text-normal",
          node.id === "root" && "tw-font-semibold"
        )}
      >
        {sizeText}
      </span>
      {node.path !== undefined && (
        <div className="tw-hidden tw-shrink-0 tw-items-center group-focus-within:tw-flex group-hover:tw-flex">
          <button
            type="button"
            className="tw-flex tw-size-6 tw-items-center tw-justify-center tw-rounded-md tw-p-0 tw-text-faint hover:tw-bg-modifier-hover hover:tw-text-normal"
            aria-label={t("localData.copyNamed", { name: node.name })}
            onClick={() => onCopy(node.path as string)}
          >
            <Copy className="tw-size-3.5" />
          </button>
          <button
            type="button"
            className="tw-flex tw-size-6 tw-items-center tw-justify-center tw-rounded-md tw-p-0 tw-text-faint hover:tw-bg-modifier-hover hover:tw-text-normal"
            aria-label={t("localData.revealNamed", { name: node.name })}
            onClick={() => onReveal(node.path as string)}
          >
            <FolderOpen className="tw-size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

interface TreeBranchProps {
  nodes: readonly LocalDataTreeNodeData[];
  depth: number;
  overrides: Readonly<Record<string, boolean>>;
  onToggle: (id: string, next: boolean) => void;
  onCopy: LocalDataPanelProps["onCopy"];
  onReveal: LocalDataPanelProps["onReveal"];
}

function LocalDataTreeBranch({
  nodes,
  depth,
  overrides,
  onToggle,
  onCopy,
  onReveal,
}: TreeBranchProps) {
  return (
    <ul
      className={cn(
        "tw-m-0 tw-list-none tw-p-0",
        depth > 0 && "tw-ml-4 tw-border-l tw-border-solid tw-border-border"
      )}
    >
      {nodes.map((node) => {
        // 树的内容默认全部折叠，只展开用户点开过的节点。
        // https://github.com/ItsDalk-Lane/Vault-Agent/issues/8
        const expanded = overrides[node.id] ?? false;
        const children = node.children ?? [];
        return (
          <li key={node.id}>
            <LocalDataTreeRow
              node={node}
              expanded={expanded}
              onToggle={onToggle}
              onCopy={onCopy}
              onReveal={onReveal}
            />
            {children.length > 0 && expanded && (
              <LocalDataTreeBranch
                nodes={children}
                depth={depth + 1}
                overrides={overrides}
                onToggle={onToggle}
                onCopy={onCopy}
                onReveal={onReveal}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LocalDataPanel({
  status,
  tree,
  loading,
  error,
  keychainGroups,
  credentialsError,
  settingsFileNote,
  onRefresh,
  onCopy,
  onReveal,
  onOpenKeychainGroup,
}: LocalDataPanelProps) {
  const [expandedOverrides, setExpandedOverrides] =
    useState<Readonly<Record<string, boolean>>>(EMPTY_OVERRIDES);
  const toggleNode = useCallback((id: string, next: boolean) => {
    setExpandedOverrides((previous) => ({ ...previous, [id]: next }));
  }, []);
  const totalBytes = status?.totalBytes ?? 0;
  const sessionsBytes = (status?.sessions ?? []).reduce((sum, session) => sum + session.bytes, 0);
  const segments = [
    { value: sessionsBytes, className: "tw-bg-interactive-accent" },
    { value: status?.settingsBytes ?? 0, className: "tw-bg-base-50" },
    { value: status?.indexBytes ?? 0, className: "tw-bg-base-35" },
  ].filter((segment) => segment.value > 0);
  const legend = [
    {
      label: t("localData.groupTranscripts"),
      value: sessionsBytes,
      className: "tw-bg-interactive-accent",
    },
    {
      label: t("localData.settings"),
      value: status?.settingsBytes ?? 0,
      className: "tw-bg-base-50",
    },
    { label: t("localData.index"), value: status?.indexBytes ?? 0, className: "tw-bg-base-35" },
    { label: t("localData.logs"), value: status?.logsBytes ?? 0, className: "" },
    { label: t("localData.temp"), value: status?.tempBytes ?? 0, className: "" },
    { label: t("localData.legendPending"), value: status?.pendingBytes ?? 0, className: "" },
  ];
  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-5 tw-py-4">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h2 className="tw-text-lg tw-font-semibold">{t("localData.title")}</h2>
        <Button variant="secondary" onClick={onRefresh} disabled={loading}>
          <RefreshCw className="tw-size-3.5" />
          {t("localData.refresh")}
        </Button>
      </div>
      <div>
        <div className="tw-text-xs tw-text-muted">{t("localData.totalLabel")}</div>
        <div className="tw-mt-1 tw-flex tw-flex-wrap tw-items-end tw-justify-between tw-gap-3">
          <div className="tw-text-2xl tw-font-semibold tw-tabular-nums tw-leading-tight tw-tracking-tight">
            {formatLocalBytes(totalBytes)}
          </div>
          <div className="tw-flex tw-flex-wrap tw-gap-1.5">
            <span className="tw-rounded-full tw-bg-secondary tw-px-2.5 tw-py-0.5 tw-text-xs tw-text-muted">
              {t("localData.chipAllVaults", { count: status?.totalSessionCount ?? 0 })}
            </span>
            <span className="tw-rounded-full tw-bg-secondary tw-px-2.5 tw-py-0.5 tw-text-xs tw-text-muted">
              {t("localData.chipCurrentVault", { count: status?.sessions.length ?? 0 })}
            </span>
          </div>
        </div>
        {totalBytes > 0 && (
          <div className="tw-bg-base-30 tw-mt-2.5 tw-flex tw-h-2 tw-gap-0.5 tw-overflow-hidden tw-rounded-full">
            {segments.map((segment) => (
              <span
                key={segment.className}
                className={cn("tw-min-w-[3px]", segment.className)}
                style={{ width: `${(segment.value / totalBytes) * 100}%` }}
                title={`${formatLocalBytes(segment.value)} · ${formatShare(segment.value, totalBytes)}`}
              />
            ))}
          </div>
        )}
        <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-x-3.5 tw-gap-y-1 tw-text-xs tw-text-muted">
          {legend.map((item) => (
            <span key={item.label}>
              <span
                className={cn(
                  "tw-mr-1.5 tw-inline-block tw-size-2 tw-rounded-sm",
                  item.value > 0 ? item.className : "tw-bg-base-30"
                )}
              />
              {item.label} {formatLocalBytes(item.value)}
            </span>
          ))}
        </div>
        <p className="tw-mt-2 tw-text-xs tw-leading-relaxed tw-text-faint">
          {t("localData.scope")}
        </p>
      </div>
      <div>
        <div className="tw-mb-2 tw-flex tw-items-baseline tw-justify-between tw-gap-3">
          <span className="tw-text-xs tw-font-semibold tw-text-muted">
            {t("localData.mapTitle")}
          </span>
          <span className="tw-text-xs tw-text-faint">{t("localData.mapHint")}</span>
        </div>
        <div className="tw-overflow-hidden tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-sm">
          <LocalDataTreeBranch
            nodes={tree}
            depth={0}
            overrides={expandedOverrides}
            onToggle={toggleNode}
            onCopy={onCopy}
            onReveal={onReveal}
          />
          <div className="tw-border-t tw-border-solid tw-border-border tw-px-4 tw-py-2.5 tw-text-xs tw-leading-relaxed tw-text-faint">
            {settingsFileNote}
          </div>
        </div>
      </div>
      <div>
        <div className="tw-mb-2 tw-text-xs tw-font-semibold tw-text-muted">
          {t("localData.nonDiskTitle")}
        </div>
        <div className="tw-overflow-hidden tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-sm">
          {keychainGroups ? (
            <div className="tw-grid tw-grid-cols-3">
              {keychainGroups.map((group, index) => (
                <button
                  type="button"
                  key={group.key}
                  className={cn(
                    "tw-px-4 tw-py-3 tw-text-left hover:tw-bg-modifier-hover",
                    index > 0 && "tw-border-l tw-border-solid tw-border-border"
                  )}
                  aria-haspopup="dialog"
                  onClick={() => onOpenKeychainGroup(group.key)}
                >
                  <span className="tw-block tw-text-lg tw-font-semibold tw-tabular-nums tw-text-normal">
                    {group.entries.length}
                  </span>
                  <span className="tw-block tw-text-xs tw-text-muted">{group.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="tw-px-4 tw-py-3 tw-text-sm">
              {credentialsError ?? t("localData.unavailable")}
            </div>
          )}
          <div className="tw-border-t tw-border-solid tw-border-border tw-px-4 tw-py-2.5 tw-text-xs tw-leading-relaxed tw-text-faint">
            {t("localData.keychainCardNote")}
          </div>
        </div>
      </div>
      {loading && <p role="status">{t("localData.loading")}</p>}
      {error && (
        <p role="alert" className="tw-break-words">
          {t("localData.error", { error })}
        </p>
      )}
    </div>
  );
}
