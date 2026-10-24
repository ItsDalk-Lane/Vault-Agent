import React, { useMemo } from "react";
import { TFile, TFolder } from "obsidian";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { FileText, Folder, Globe, Image, Bot } from "lucide-react";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import type { WebTabContext } from "@/types/message";
import { t } from "@/i18n";

export type AtMentionCategory =
  | "agents"
  | "notes"
  | "folders"
  | "activeNote"
  | "webTabs"
  | "activeWebTab"
  | "images";

export interface AtMentionOption extends TypeaheadOption {
  category: AtMentionCategory;
  data: TFile | string | TFolder | WebTabContext;
  isAction?: boolean;
}

export interface AgentMentionBrand {
  readonly id: string;
  readonly displayName: string;
  readonly Icon: React.ComponentType<{ className?: string }>;
}

export const EMPTY_AGENT_MENTION_BRANDS: ReadonlyArray<AgentMentionBrand> = Object.freeze([]);

export interface CategoryOption extends TypeaheadOption {
  category: AtMentionCategory;
  icon: React.ReactNode;
  isAction?: boolean;
}

function buildAgentsCategory(): CategoryOption {
  return {
    key: "agents",
    title: t("ui.chat.agents"),
    subtitle: t("ui.chat.agentsDesc"),
    category: "agents",
    icon: <Bot className="tw-size-4" />,
  };
}

function buildCategoryOptions(): CategoryOption[] {
  return [
    {
      key: "notes",
      title: t("ui.chat.notes"),
      subtitle: t("ui.chat.notesDesc"),
      category: "notes",
      icon: <FileText className="tw-size-4" />,
    },
    {
      key: "webTabs",
      title: t("ui.chat.webTabs"),
      subtitle: t("ui.chat.webTabsDesc"),
      category: "webTabs",
      icon: <Globe className="tw-size-4" />,
    },
    {
      key: "folders",
      title: t("ui.chat.folders"),
      subtitle: t("ui.chat.foldersDesc"),
      category: "folders",
      icon: <Folder className="tw-size-4" />,
    },
    {
      key: "images",
      title: t("ui.chat.images"),
      subtitle: t("ui.chat.imagesDesc"),
      category: "images",
      icon: <Image className="tw-size-4" />,
      isAction: true,
    },
  ];
}

export function useAtMentionCategories(showAgents: boolean = false): CategoryOption[] {
  return useMemo(() => {
    const base = buildCategoryOptions().filter((cat) => {
      if (cat.category === "webTabs") {
        return isDesktopRuntime();
      }
      return true;
    });
    return showAgents ? [buildAgentsCategory(), ...base] : base;
  }, [showAgents]);
}
