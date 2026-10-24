import { SkillRowLayout } from "./SkillRowLayout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { Edit3, FolderSearch, MoreVertical, Settings, Trash2 } from "lucide-react";
import { Notice } from "obsidian";
import React from "react";
import { logError } from "@/logger";
import { SkillManager } from "@/agentMode/skills/SkillManager";
import { formatSkillDisplayName } from "@/agentMode/skills/mergeDiscovery";
import type { Skill } from "@/agentMode/skills/types";

interface SkillRowProps {
  skill: Skill;
  onEditSkillMd?: () => void;
  onEditProperties?: () => void;
  onRevealInVault?: () => void;
  onDelete?: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

export const SkillRow: React.FC<SkillRowProps> = ({
  skill,
  onEditSkillMd,
  onEditProperties,
  onRevealInVault,
  onDelete,
  containerRef,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const handleToggle = async (enabled: boolean): Promise<void> => {
    try {
      const result = await SkillManager.getInstance().setSkillEnabled(skill, enabled);
      // 技能写入失败必须就地提示，避免权限错误被静默忽略。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (!result.ok) {
        new Notice(
          t(
            enabled
              ? "agentInfra.skills.notice.enableFailed"
              : "agentInfra.skills.notice.disableFailed",
            { agent: "Vault Agent", error: result.message }
          )
        );
      }
    } catch (error) {
      logError("[skills] Failed to change skill enablement", error);
      new Notice(
        t("agentInfra.skills.updateFailed", {
          name: skill.name,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };
  // 历史来源只供查看，不能恢复旧代理目录的写入操作。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  return (
    <SkillRowLayout
      name={formatSkillDisplayName(skill)}
      description={skill.description}
      menuOpen={menuOpen}
      annotations={
        <>
          {skill.userInvocable === false && (
            <Badge variant="secondary">{t("agentInfra.skills.chip.hiddenFromSlash")}</Badge>
          )}
          {skill.location.kind === "project" && (
            <span className="tw-truncate tw-text-ui-smaller tw-text-faint">{skill.dirPath}</span>
          )}
        </>
      }
      controls={
        <SettingSwitch
          disabled={skill.location.kind === "project"}
          title={
            skill.location.kind === "project"
              ? t("agentInfra.skills.manager.legacyReadOnly")
              : undefined
          }
          checked={skill.enabledAgents.includes("pi")}
          aria-label={t("agentInfra.skills.row.enabled", { name: skill.name })}
          onCheckedChange={(enabled) => {
            void handleToggle(enabled);
          }}
        />
      }
      actions={
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title={t("agentInfra.skills.actions.more")}
              aria-label={t("agentInfra.skills.actions.moreFor", { name: skill.name })}
            >
              <MoreVertical className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="tw-min-w-[180px]"
            container={containerRef.current}
          >
            {skill.location.kind === "canonical" && (
              <>
                <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onEditSkillMd}>
                  <Edit3 className="tw-size-3.5" aria-hidden="true" />
                  {t("agentInfra.skills.row.editSkillMd")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-gap-2.5 tw-text-ui-small"
                  onSelect={onEditProperties}
                >
                  <Settings className="tw-size-3.5" aria-hidden="true" />
                  {t("agentInfra.skills.row.properties")}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onRevealInVault}>
              <FolderSearch className="tw-size-3.5" aria-hidden="true" />
              {t("agentInfra.skills.row.reveal")}
            </DropdownMenuItem>
            {skill.location.kind === "canonical" && (
              <DropdownMenuItem
                className="tw-gap-2.5 tw-text-ui-small tw-text-error focus:tw-bg-modifier-error-rgb/15 focus:tw-text-error"
                onSelect={onDelete}
              >
                <Trash2 className="tw-size-3.5" aria-hidden="true" />
                {t("agentInfra.skills.row.delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
};
